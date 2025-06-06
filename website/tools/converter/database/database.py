from datetime import datetime, timedelta
from pathlib import Path

from pymongo import DESCENDING, UpdateOne

from .models import FileData, ConvertedFileDataFromDb
from ..messages.messages import StatisticsMessage, ConvertedFileData
from . import media_collection


class DatabaseTools:
    def __init__(self) -> None:
        pass

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
            self._create_converted_data(count, ConvertedFileDataFromDb(**data))
            for count, data in enumerate(db_file_list)
        ]

        return file_list

    async def get_converting_files(self) -> list[FileData] | None:
        if media_collection is None:
            return None

        # Get the files where converting or copying is True from MongoDB
        db_file = media_collection.find(
            {"$or": [{"converting": True}, {"copying": True}]}
        )

        # Convert the list of FileData objects to a list of file paths
        if db_file is not None:
            file_data_list = [FileData(**data) async for data in db_file]

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
        total_converted = await media_collection.count_documents({"converted": True})

        # Get the total number of files that need to be converted
        total_to_convert = await media_collection.count_documents(
            {
                "conversion_required": True,
                "converted": False,
                "converting": False,
                "conversion_error": False,
            }
        )

        # Get the total number of files that are currently being converted
        total_converting = await media_collection.count_documents({"converting": True})

        # Add the number of files that are currently being converted to the total number of files that need to be converted
        total_to_convert += total_converting

        # Get the total number of gigabytes before conversion
        gigabytes_before_conversion_db = await media_collection.aggregate(
            [
                {"$match": {"converted": True}},
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
                {"$match": {"converted": True}},
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
                {"$match": {"converted": True}},
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
                {"$match": {"conversion_required": True}},
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
                {"$match": {"conversion_required": True}},
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
            {"converted": True, "filename": {"$regex": r"Films"}}
        )

        # Get the number of films which have to be converted
        total_films_to_convert = await media_collection.count_documents(
            {
                "conversion_required": True,
                "converted": False,
                "conversion_error": False,
                "filename": {"$regex": r"Films"},
            }
        )

        # Get the number of films which are currently being converted
        total_films_converting = await media_collection.count_documents(
            {"conversion_in_progress": True, "filename": {"$regex": r"Films"}}
        )

        # Get the count of conversion errors
        total_conversion_errors = await media_collection.count_documents(
            {"conversion_error": True}
        )

        # Get the total number of files converted by each backed sorted by backend name
        total_files_converted_by_backend_db = media_collection.aggregate(
            [
                {"$match": {"converted": True}},
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
            {"conversion_error": True}, projection=["filename"]
        )

        # Create a list of UpdateOne objects to set the conversion_error field to False
        update_requests = [
            UpdateOne(
                {"filename": file_data["filename"]},
                {"$set": {"conversion_error": False}},
            )
            async for file_data in files_with_errors
        ]

        # Update the documents in the database
        result = await media_collection.bulk_write(update_requests)

        # Return True if the update was successful
        return result.acknowledged
