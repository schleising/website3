from datetime import datetime, timedelta
from pathlib import Path
from bisect import bisect_left
from statistics import median
from typing import Any, Mapping

from pymongo import DESCENDING, UpdateOne

from .models import FileData, ConvertedFileDataFromDb
from ..messages.messages import StatisticsMessage, ConvertedFileData, FileToConvertData
from . import media_collection


class DatabaseTools:
    def __init__(self) -> None:
        self._prediction_cache_ttl = timedelta(minutes=5)
        self._prediction_cache_time: datetime | None = None
        self._prediction_bitrates: list[float] = []
        self._prediction_saved_ratios_by_bitrate: list[float] = []
        self._prediction_bitrate_band_ratios: dict[int, float] = {}
        self._prediction_codec_ratios: dict[str, float] = {}
        self._prediction_size_bucket_ratios: dict[int, float] = {}
        self._prediction_global_ratio: float = 0.25

    def _human_readable_file_size(self, size: float) -> str:
        # Convert the file size to a human-readable format
        for unit in ["B", "KB", "MB", "GB", "TB"]:
            if size < 1024.0:
                return f"{size:.2f} {unit}"
            size = size / 1024

        return f"{size:.2f} PB"

    def _create_converted_data(
        self, count: int, file_data: ConvertedFileDataFromDb
    ) -> ConvertedFileData:
        # Calculate the compression percentage
        compression_percentage = (
            1 - (file_data.current_size / file_data.pre_conversion_size)
        ) * 100

        # Calculate the total conversion time
        if (
            file_data.start_conversion_time is None
            or file_data.end_conversion_time is None
        ):
            start_time = "Unknown"
            end_time = "Unknown"
            total_conversion_time = timedelta(milliseconds=0)
        else:
            # Times in Mon Jul 19 12:43 format
            start_time = file_data.start_conversion_time.isoformat()
            end_time = file_data.end_conversion_time.isoformat()
            total_conversion_time = (
                file_data.end_conversion_time - file_data.start_conversion_time
            )

        # Convert the total conversion time to a string in the format "HH hours MM minutes"
        hours = total_conversion_time.seconds // 3600
        minutes = (total_conversion_time.seconds // 60) % 60

        if hours == 0:
            total_conversion_time_string = f"{minutes} minutes"
        elif hours == 1:
            total_conversion_time_string = f"1 hour {minutes} minutes"
        elif minutes == 0:
            total_conversion_time_string = f"{hours} hours"
        else:
            total_conversion_time_string = f"{hours} hours {minutes} minutes"

        # Create a ConvertedFileData object
        return ConvertedFileData(
            file_data_id=f"file-{count}",
            filename=Path(file_data.filename).name,
            start_conversion_time=start_time,
            end_conversion_time=end_time,
            total_conversion_time=total_conversion_time_string,
            pre_conversion_size=self._human_readable_file_size(
                file_data.pre_conversion_size
            ),
            current_size=self._human_readable_file_size(file_data.current_size),
            percentage_saved=round(compression_percentage),
        )

    def _format_video_duration(self, duration_seconds: float | int | None) -> str:
        if duration_seconds is None:
            return "Unknown"

        try:
            total_seconds = int(float(duration_seconds))
        except (TypeError, ValueError):
            return "Unknown"

        hours = total_seconds // 3600
        minutes = (total_seconds % 3600) // 60
        seconds = total_seconds % 60

        if hours > 0:
            return f"{hours}:{minutes:02d}:{seconds:02d}"

        return f"{minutes}:{seconds:02d}"

    def _get_codec_name(self, db_file: Mapping[str, Any], codec_type: str) -> str:
        streams = db_file.get("video_information", {}).get("streams", [])

        for stream in streams:
            if stream.get("codec_type") == codec_type and stream.get("codec_name"):
                return str(stream.get("codec_name")).upper()

        return "Unknown"

    def _format_bit_rate(self, bit_rate_value: Any) -> str:
        if bit_rate_value is None:
            return "Unknown"

        try:
            bit_rate = float(bit_rate_value)
        except (TypeError, ValueError):
            return "Unknown"

        if bit_rate <= 0:
            return "Unknown"

        if bit_rate >= 1_000_000_000:
            return f"{(bit_rate / 1_000_000_000):.2f} Gbps"

        if bit_rate >= 1_000_000:
            return f"{(bit_rate / 1_000_000):.2f} Mbps"

        if bit_rate >= 1_000:
            return f"{(bit_rate / 1_000):.2f} Kbps"

        return f"{bit_rate:.0f} bps"

    def _get_size_bucket_key(self, pre_conversion_size: float) -> int:
        if pre_conversion_size < 750_000_000:
            return 0
        if pre_conversion_size < 1_500_000_000:
            return 1
        if pre_conversion_size < 3_000_000_000:
            return 2
        if pre_conversion_size < 6_000_000_000:
            return 3
        if pre_conversion_size < 12_000_000_000:
            return 4
        return 5

    def _get_bitrate_band_key(self, bit_rate: float) -> int:
        if bit_rate < 1_500_000:
            return 0
        if bit_rate < 2_500_000:
            return 1
        if bit_rate < 4_000_000:
            return 2
        if bit_rate < 6_000_000:
            return 3
        if bit_rate < 10_000_000:
            return 4
        return 5

    async def _get_prediction_models(
        self,
    ) -> tuple[
        list[float],
        list[float],
        dict[int, float],
        dict[str, float],
        dict[int, float],
        float,
    ]:
        if media_collection is None:
            return [], [], {}, {}, {}, 0.25

        now = datetime.now()
        if (
            self._prediction_cache_time is not None
            and now - self._prediction_cache_time < self._prediction_cache_ttl
        ):
            return (
                self._prediction_bitrates,
                self._prediction_saved_ratios_by_bitrate,
                self._prediction_bitrate_band_ratios,
                self._prediction_codec_ratios,
                self._prediction_size_bucket_ratios,
                self._prediction_global_ratio,
            )

        db_file_cursor = media_collection.find(
            {
                "conversion_required": True,
                "converted": True,
                "conversion_error": False,
                "deleted": False,
                "pre_conversion_size": {"$gt": 0},
                "current_size": {"$gt": 0},
            },
            sort=[("end_conversion_time", DESCENDING)],
            projection=[
                "pre_conversion_size",
                "current_size",
                "video_information.format.bit_rate",
                "video_information.streams.codec_type",
                "video_information.streams.codec_name",
            ],
        ).limit(10000)

        db_file_list = await db_file_cursor.to_list(length=10000)

        codec_ratios: dict[str, list[float]] = {}
        bitrate_band_ratios: dict[int, list[float]] = {}
        size_bucket_ratios: dict[int, list[float]] = {}
        global_ratios: list[float] = []
        bitrate_samples: list[tuple[float, float]] = []

        for db_file in db_file_list:
            pre_conversion_size = db_file.get("pre_conversion_size")
            current_size = db_file.get("current_size")

            if pre_conversion_size is None or current_size is None:
                continue

            try:
                pre_size = float(pre_conversion_size)
                current = float(current_size)
            except (TypeError, ValueError):
                continue

            if pre_size <= 0:
                continue

            saved_ratio = (pre_size - current) / pre_size
            saved_ratio = max(0.0, min(saved_ratio, 0.95))

            global_ratios.append(saved_ratio)

            size_bucket = self._get_size_bucket_key(pre_size)
            size_bucket_ratios.setdefault(size_bucket, []).append(saved_ratio)

            bit_rate = (
                db_file.get("video_information", {})
                .get("format", {})
                .get("bit_rate")
            )
            try:
                parsed_bit_rate = float(bit_rate)
            except (TypeError, ValueError):
                parsed_bit_rate = 0.0

            if parsed_bit_rate > 0:
                bitrate_samples.append((parsed_bit_rate, saved_ratio))
                bitrate_band = self._get_bitrate_band_key(parsed_bit_rate)
                bitrate_band_ratios.setdefault(bitrate_band, []).append(saved_ratio)

            video_codec = self._get_codec_name(db_file, "video")
            if video_codec != "Unknown":
                codec_ratios.setdefault(video_codec, []).append(saved_ratio)

        global_ratio = self._prediction_global_ratio
        if len(global_ratios) > 0:
            global_ratio = float(median(global_ratios))

        final_codec_ratios = {
            codec: float(median(ratios)) for codec, ratios in codec_ratios.items() if len(ratios) > 0
        }

        final_bitrate_band_ratios = {
            band: float(median(ratios))
            for band, ratios in bitrate_band_ratios.items()
            if len(ratios) > 0
        }

        final_size_bucket_ratios = {
            bucket: float(median(ratios))
            for bucket, ratios in size_bucket_ratios.items()
            if len(ratios) > 0
        }

        bitrate_samples.sort(key=lambda item: item[0])
        final_bitrates = [item[0] for item in bitrate_samples]
        final_saved_ratios_by_bitrate = [item[1] for item in bitrate_samples]

        self._prediction_cache_time = now
        self._prediction_bitrates = final_bitrates
        self._prediction_saved_ratios_by_bitrate = final_saved_ratios_by_bitrate
        self._prediction_bitrate_band_ratios = final_bitrate_band_ratios
        self._prediction_codec_ratios = final_codec_ratios
        self._prediction_size_bucket_ratios = final_size_bucket_ratios
        self._prediction_global_ratio = global_ratio

        return (
            final_bitrates,
            final_saved_ratios_by_bitrate,
            final_bitrate_band_ratios,
            final_codec_ratios,
            final_size_bucket_ratios,
            global_ratio,
        )

    def _estimate_saved_ratio_from_bitrate(
        self,
        bit_rate: float,
        bitrates: list[float],
        saved_ratios_by_bitrate: list[float],
    ) -> tuple[float, int] | None:
        if bit_rate <= 0 or len(bitrates) == 0:
            return None

        insert_index = bisect_left(bitrates, bit_rate)
        search_window = 80
        window_start = max(0, insert_index - search_window)
        window_end = min(len(bitrates), insert_index + search_window)

        candidate_indices = range(window_start, window_end)
        nearest_indices = sorted(
            candidate_indices,
            key=lambda index: abs(bitrates[index] - bit_rate),
        )[:25]

        if len(nearest_indices) < 8:
            return None

        nearest_ratios = [saved_ratios_by_bitrate[index] for index in nearest_indices]
        return float(median(nearest_ratios)), len(nearest_indices)

    def _get_prediction_saved_ratio(
        self,
        base_size: float,
        bit_rate: Any,
        video_codec: str,
        bitrates: list[float],
        saved_ratios_by_bitrate: list[float],
        bitrate_band_ratios: Mapping[int, float],
        codec_ratios: Mapping[str, float],
        size_bucket_ratios: Mapping[int, float],
        global_ratio: float,
    ) -> tuple[float, str, str]:
        try:
            parsed_bit_rate = float(bit_rate)
        except (TypeError, ValueError):
            parsed_bit_rate = 0.0

        confidence = "Low"
        basis = "Global fallback"

        bitrate_prediction = self._estimate_saved_ratio_from_bitrate(
            parsed_bit_rate,
            bitrates,
            saved_ratios_by_bitrate,
        )

        if bitrate_prediction is not None:
            ratio, nearest_count = bitrate_prediction
            basis = f"Bitrate nearest neighbors ({nearest_count} samples)"

            if nearest_count >= 20:
                confidence = "High"
            elif nearest_count >= 12:
                confidence = "Medium"
            else:
                confidence = "Low"
        else:
            ratio = None

        if ratio is None:
            bitrate_band_ratio = None
            if parsed_bit_rate > 0:
                bitrate_band = self._get_bitrate_band_key(parsed_bit_rate)
                bitrate_band_ratio = bitrate_band_ratios.get(bitrate_band)

            if bitrate_band_ratio is not None:
                ratio = bitrate_band_ratio
                confidence = "Medium"
                basis = "Bitrate band median"
            else:
                ratio = codec_ratios.get(video_codec)
                if ratio is not None:
                    confidence = "Low"
                    basis = f"Codec fallback ({video_codec})"

        if ratio is None:
            ratio = global_ratio
            confidence = "Low"
            basis = "Global fallback"

        if parsed_bit_rate > 0:
            bitrate_band = self._get_bitrate_band_key(parsed_bit_rate)
            bitrate_band_ratio = bitrate_band_ratios.get(bitrate_band)

            if bitrate_band_ratio is not None:
                if parsed_bit_rate < 4_000_000:
                    bitrate_weight = 0.75
                elif parsed_bit_rate < 8_000_000:
                    bitrate_weight = 0.55
                else:
                    bitrate_weight = 0.35

                ratio = (ratio * (1 - bitrate_weight)) + (
                    bitrate_band_ratio * bitrate_weight
                )

                # Keep low-bitrate predictions conservative.
                if parsed_bit_rate < 2_500_000:
                    ratio = min(ratio, bitrate_band_ratio + 0.08)
                elif parsed_bit_rate < 4_000_000:
                    ratio = min(ratio, bitrate_band_ratio + 0.12)

                if "Bitrate" not in basis:
                    basis = basis + " + bitrate band calibration"

        size_bucket = self._get_size_bucket_key(base_size)
        size_bucket_ratio = size_bucket_ratios.get(size_bucket)

        if size_bucket_ratio is not None:
            if base_size < 1_500_000_000:
                size_weight = 0.7
            elif base_size < 6_000_000_000:
                size_weight = 0.5
            else:
                size_weight = 0.3

            ratio = (ratio * (1 - size_weight)) + (size_bucket_ratio * size_weight)

            # Keep small-file predictions conservative.
            if base_size < 1_500_000_000:
                ratio = min(ratio, size_bucket_ratio + 0.12)

            basis = basis + " + size calibration"

        return max(0.0, min(ratio, 0.95)), confidence, basis

    def _create_file_to_convert_data(
        self,
        count: int,
        db_file: Mapping[str, Any],
        bitrates: list[float],
        saved_ratios_by_bitrate: list[float],
        bitrate_band_ratios: Mapping[int, float],
        codec_ratios: Mapping[str, float],
        size_bucket_ratios: Mapping[int, float],
        global_ratio: float,
    ) -> FileToConvertData:
        current_size = db_file.get("current_size") or db_file.get("pre_conversion_size") or 0

        duration = (
            db_file.get("video_information", {})
            .get("format", {})
            .get("duration")
        )

        bit_rate = (
            db_file.get("video_information", {})
            .get("format", {})
            .get("bit_rate")
        )

        video_codec = self._get_codec_name(db_file, "video")

        base_size_value = db_file.get("pre_conversion_size") or db_file.get("current_size")
        estimated_size_after_conversion = "Unknown"
        estimated_percentage_saved = 0

        if base_size_value is not None:
            try:
                base_size = float(base_size_value)
            except (TypeError, ValueError):
                base_size = 0

            if base_size > 0:
                saved_ratio, prediction_confidence, _ = self._get_prediction_saved_ratio(
                    base_size,
                    bit_rate,
                    video_codec,
                    bitrates,
                    saved_ratios_by_bitrate,
                    bitrate_band_ratios,
                    codec_ratios,
                    size_bucket_ratios,
                    global_ratio,
                )
                estimated_final_size = max(0.0, base_size * (1 - saved_ratio))
                estimated_size_after_conversion = self._human_readable_file_size(
                    estimated_final_size
                )
                estimated_percentage_saved = round(saved_ratio * 100)
            else:
                prediction_confidence = "Low"
        else:
            prediction_confidence = "Low"

        return FileToConvertData(
            file_data_id=f"file-to-convert-{count}",
            filename=Path(db_file.get("filename", "Unknown")).name,
            current_size=self._human_readable_file_size(float(current_size)),
            estimated_size_after_conversion=estimated_size_after_conversion,
            estimated_percentage_saved=estimated_percentage_saved,
            prediction_confidence=prediction_confidence,
            bit_rate=self._format_bit_rate(bit_rate),
            video_codec=video_codec,
            audio_codec=self._get_codec_name(db_file, "audio"),
            video_duration=self._format_video_duration(duration),
        )

    async def get_converted_files(self) -> list[ConvertedFileData]:
        if media_collection is None:
            return []

        # Find files that have been converted in the last day, sorted by the time they were converted in descending order
        # Returning only the filename, pre_conversion_size and current_size fields
        db_file_cursor = media_collection.find(
            {
                "conversion_required": True,
                "converting": False,
                "converted": True,
                "conversion_error": False,
                "deleted": False,
                "end_conversion_time": {"$gte": datetime.now() - timedelta(days=7)},
            },
            sort=[("end_conversion_time", DESCENDING)],
            projection=[
                "filename",
                "start_conversion_time",
                "end_conversion_time",
                "pre_conversion_size",
                "current_size",
            ],
        )

        db_file_list = await db_file_cursor.to_list(length=None)

        # Convert the list of FileData objects to a list of file paths
        file_list = [
            self._create_converted_data(
                count, ConvertedFileDataFromDb.model_validate(data)
            )
            for count, data in enumerate(db_file_list)
        ]

        return file_list

    async def get_files_to_convert(self) -> list[FileToConvertData]:
        if media_collection is None:
            return []

        (
            bitrates,
            saved_ratios_by_bitrate,
            bitrate_band_ratios,
            codec_ratios,
            size_bucket_ratios,
            global_ratio,
        ) = await self._get_prediction_models()

        db_file_cursor = media_collection.find(
            {
                "conversion_required": True,
                "converted": False,
                "converting": False,
                "conversion_error": False,
                "deleted": False,
            },
            sort=[("video_information.format.bit_rate", DESCENDING)],
            projection=[
                "filename",
                "current_size",
                "pre_conversion_size",
                "video_information.streams.codec_type",
                "video_information.streams.codec_name",
                "video_information.format.duration",
                "video_information.format.bit_rate",
            ],
        )

        db_file_list = await db_file_cursor.to_list(length=None)

        return [
            self._create_file_to_convert_data(
                count,
                db_file,
                bitrates,
                saved_ratios_by_bitrate,
                bitrate_band_ratios,
                codec_ratios,
                size_bucket_ratios,
                global_ratio,
            )
            for count, db_file in enumerate(db_file_list)
        ]

    async def get_converting_files(self) -> list[FileData] | None:
        if media_collection is None:
            return None

        # Get the files where converting or copying is True from MongoDB
        db_file = media_collection.find(
            {
                "$or": [
                    {"converting": True, "deleted": False},
                    {"copying": True, "deleted": False},
                ]
            }
        )

        # Convert the list of FileData objects to a list of file paths
        if db_file is not None:
            file_data_list = [FileData.model_validate(data) async for data in db_file]

            return sorted(file_data_list, key=lambda file_data: file_data.backend_name)

        return None

    async def get_statistics(self) -> StatisticsMessage:
        if media_collection is None:
            return StatisticsMessage(
                total_files=0,
                total_converted=0,
                total_to_convert=0,
                gigabytes_before_conversion=0,
                gigabytes_after_conversion=0,
                gigabytes_saved=0,
                percentage_saved=0,
                total_conversion_time="0 days 00:00:00",
                total_size_before_conversion_tb=0,
                total_size_after_conversion_tb=0,
                films_converted=0,
                films_to_convert=0,
                conversion_errors=0,
                conversions_by_backend={},
            )

        # Get the total number of files in the database
        total_files = await media_collection.count_documents({})

        # Get the total number of files that have been converted
        total_converted = await media_collection.count_documents(
            {"converted": True, "deleted": False}
        )

        # Get the total number of files that need to be converted
        total_to_convert = await media_collection.count_documents(
            {
                "conversion_required": True,
                "converted": False,
                "converting": False,
                "conversion_error": False,
                "deleted": False,
            }
        )

        # Get the total number of files that are currently being converted
        total_converting = await media_collection.count_documents(
            {"converting": True, "deleted": False}
        )

        # Add the number of files that are currently being converted to the total number of files that need to be converted
        total_to_convert += total_converting

        # Get the total number of gigabytes before conversion
        gigabytes_before_conversion_db = await media_collection.aggregate(
            [
                {"$match": {"converted": True, "deleted": False}},
                {"$group": {"_id": None, "total": {"$sum": "$pre_conversion_size"}}},
            ]
        ).to_list(length=None)

        # Convert the total number of bytes to gigabytes
        if gigabytes_before_conversion_db:
            gigabytes_before_conversion = float(
                gigabytes_before_conversion_db[0]["total"] / 1000000000
            )
        else:
            # If there are no files in the database, set the total number of gigabytes to 0
            gigabytes_before_conversion = 0

        # Get the total number of gigabytes after conversion
        gigabytes_after_conversion_db = await media_collection.aggregate(
            [
                {"$match": {"converted": True, "deleted": False}},
                {"$group": {"_id": None, "total": {"$sum": "$current_size"}}},
            ]
        ).to_list(length=None)

        # Convert the total number of bytes to gigabytes
        if gigabytes_after_conversion_db:
            gigabytes_after_conversion = float(
                gigabytes_after_conversion_db[0]["total"] / 1000000000
            )
        else:
            # If there are no files in the database, set the total number of gigabytes to 0
            gigabytes_after_conversion = gigabytes_before_conversion

        # Get the total number of gigabytes saved
        gigabytes_saved = gigabytes_before_conversion - gigabytes_after_conversion

        # Get the percentage saved
        if gigabytes_before_conversion != 0:
            percentage_saved = gigabytes_saved / gigabytes_before_conversion * 100
        else:
            # If there are no files in the database, set the percentage saved to 0
            percentage_saved = 0

        # Get the total conversion time from the database
        total_conversion_time_db = await media_collection.aggregate(
            [
                {"$match": {"converted": True, "deleted": False}},
                {
                    "$group": {
                        "_id": None,
                        "total": {
                            "$sum": {
                                "$subtract": [
                                    "$end_conversion_time",
                                    "$start_conversion_time",
                                ]
                            }
                        },
                    }
                },
            ]
        ).to_list(length=None)

        # Convert the total conversion time to a timedelta object
        if total_conversion_time_db:
            total_conversion_time = timedelta(
                milliseconds=total_conversion_time_db[0]["total"]
            )
        else:
            # If there are no files in the database, set the total conversion time to 0
            total_conversion_time = timedelta(milliseconds=0)

        # Convert the total conversion time to a string in the format "n days HH:MM:SS"
        total_conversion_time_string = str(total_conversion_time).split(".")[0]

        # Get the total size of all of the video files requiring conversion before conversion by summing the pre_conversion_size field
        total_size_before_conversion_db = await media_collection.aggregate(
            [
                {"$match": {"conversion_required": True, "deleted": False}},
                {"$group": {"_id": None, "total": {"$sum": "$pre_conversion_size"}}},
            ]
        ).to_list(length=None)

        # Convert the total number of bytes to terabytes
        if total_size_before_conversion_db:
            total_size_before_conversion = float(
                total_size_before_conversion_db[0]["total"] / 1000000000000
            )
        else:
            # If there are no files in the database, set the total number of terabytes to 0
            total_size_before_conversion = 0

        # Get the total size of all of the video files requiring conversion after conversion by summing the current_size field
        total_size_after_conversion_db = await media_collection.aggregate(
            [
                {"$match": {"conversion_required": True, "deleted": False}},
                {"$group": {"_id": None, "total": {"$sum": "$current_size"}}},
            ]
        ).to_list(length=None)

        # Convert the total number of bytes to terabytes
        if total_size_after_conversion_db:
            total_size_after_conversion = float(
                total_size_after_conversion_db[0]["total"] / 1000000000000
            )
        else:
            # If there are no files in the database, set the total number of terabytes to 0
            total_size_after_conversion = total_size_before_conversion

        # Get the number of films which have been converted
        total_films_converted = await media_collection.count_documents(
            {"converted": True, "deleted": False, "filename": {"$regex": r"Films"}}
        )

        # Get the number of films which have to be converted
        total_films_to_convert = await media_collection.count_documents(
            {
                "conversion_required": True,
                "converted": False,
                "conversion_error": False,
                "deleted": False,
                "filename": {"$regex": r"Films"},
            }
        )

        # Get the number of films which are currently being converted
        total_films_converting = await media_collection.count_documents(
            {
                "conversion_in_progress": True,
                "deleted": False,
                "filename": {"$regex": r"Films"},
            }
        )

        # Get the count of conversion errors
        total_conversion_errors = await media_collection.count_documents(
            {"conversion_error": True, "deleted": False}
        )

        # Get the total number of files converted by each backed sorted by backend name
        total_files_converted_by_backend_db = media_collection.aggregate(
            [
                {"$match": {"converted": True, "deleted": False}},
                {"$group": {"_id": "$backend_name", "total": {"$sum": 1}}},
                {"$sort": {"_id": 1}},
            ]
        )

        # Create a dictionary of backend names and the number of files converted by each backend
        conversions_by_backend: dict[str, int] = {}

        # Iterate through the list of files converted by each backend
        async for backend in total_files_converted_by_backend_db:
            # Get the backend name without the number at the end
            backend_stem = backend["_id"].split("-")[0]

            # If the backend name is not in the dictionary, add it
            if backend_stem not in conversions_by_backend:
                conversions_by_backend[backend_stem] = 0

            # Add the number of files converted by the backend to the total for that backend
            conversions_by_backend[backend_stem] += backend["total"]

        # Sort the dictionary by descending value
        conversions_by_backend = dict(
            sorted(
                conversions_by_backend.items(), key=lambda item: item[1], reverse=True
            )
        )

        # Create a StatisticsMessage from the database objects
        statistics_message = StatisticsMessage(
            total_files=total_files,
            total_converted=total_converted,
            total_to_convert=total_to_convert,
            gigabytes_before_conversion=round(gigabytes_before_conversion, 3),
            gigabytes_after_conversion=round(gigabytes_after_conversion, 3),
            gigabytes_saved=round(gigabytes_saved, 3),
            percentage_saved=int(percentage_saved),
            total_conversion_time=total_conversion_time_string,
            total_size_before_conversion_tb=round(total_size_before_conversion, 3),
            total_size_after_conversion_tb=round(total_size_after_conversion, 3),
            films_converted=total_films_converted,
            films_to_convert=total_films_to_convert + total_films_converting,
            conversion_errors=total_conversion_errors,
            conversions_by_backend=conversions_by_backend,
        )

        # Return the StatisticsMessage
        return statistics_message

    async def retry_conversion_errors(self) -> bool:
        if media_collection is None:
            return False

        # Get the file names of the files that have conversion errors
        files_with_errors = media_collection.find(
            {"conversion_error": True, "deleted": False}, projection=["filename"]
        )

        # Create a list of UpdateOne objects to set the conversion_error field to False
        update_requests = [
            UpdateOne(
                {"filename": file_data["filename"], "deleted": False},
                {"$set": {"conversion_error": False}},
            )
            async for file_data in files_with_errors
        ]

        # Update the documents in the database
        result = await media_collection.bulk_write(update_requests)

        # Return True if the update was successful
        return result.acknowledged
