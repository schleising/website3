from datetime import datetime
from pathlib import Path
from typing import Any, Mapping

from bson import ObjectId
from pymongo import DESCENDING

from ..database.database import Database


mongodb = Database()
mongodb.set_database("media")
media_collection = mongodb.get_collection("media_collection", tz_aware=True)


class MediaDatabase:
    def _human_readable_file_size(self, size_value: Any) -> str:
        try:
            size = float(size_value)
        except (TypeError, ValueError):
            return "Unknown"

        if size <= 0:
            return "Unknown"

        for unit in ["B", "KB", "MB", "GB", "TB"]:
            if size < 1024.0:
                return f"{size:.2f} {unit}"
            size = size / 1024.0

        return f"{size:.2f} PB"

    def _format_video_duration(self, duration_seconds: Any) -> str:
        try:
            total_seconds = int(float(duration_seconds))
        except (TypeError, ValueError):
            return "Unknown"

        if total_seconds < 0:
            return "Unknown"

        hours = total_seconds // 3600
        minutes = (total_seconds % 3600) // 60
        seconds = total_seconds % 60

        if hours > 0:
            return f"{hours}:{minutes:02d}:{seconds:02d}"

        return f"{minutes}:{seconds:02d}"

    def _format_bit_rate(self, bit_rate_value: Any) -> str:
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

    def _format_datetime(self, value: Any) -> str | None:
        if isinstance(value, datetime):
            return value.isoformat()

        return None

    def _get_codec_name(self, db_file: Mapping[str, Any], codec_type: str) -> str:
        streams = db_file.get("video_information", {}).get("streams", [])

        for stream in streams:
            if stream.get("codec_type") == codec_type and stream.get("codec_name"):
                return str(stream.get("codec_name")).upper()

        return "Unknown"

    def _serialize_document(self, value: Any) -> Any:
        if isinstance(value, datetime):
            return value.isoformat()

        if isinstance(value, ObjectId):
            return str(value)

        if isinstance(value, dict):
            return {
                str(key): self._serialize_document(item)
                for key, item in value.items()
            }

        if isinstance(value, list):
            return [self._serialize_document(item) for item in value]

        return value

    def _create_media_row(self, db_file: Mapping[str, Any]) -> dict[str, Any]:
        filename = str(db_file.get("filename") or "Unknown")
        display_name = Path(filename).name
        parent_directory = str(Path(filename).parent)

        converted = bool(db_file.get("converted", False))
        converting = bool(db_file.get("converting", False))
        copying = bool(db_file.get("copying", False))
        conversion_required = bool(db_file.get("conversion_required", False))
        conversion_error = bool(db_file.get("conversion_error", False))
        deleted = bool(db_file.get("deleted", False))

        if conversion_error:
            status_label = "Conversion error"
        elif copying:
            status_label = "Copying"
        elif converting:
            status_label = "Converting"
        elif converted:
            status_label = "Converted"
        elif conversion_required:
            status_label = "Queued"
        else:
            status_label = "Idle"

        format_data = db_file.get("video_information", {}).get("format", {})

        return {
            "filename": filename,
            "display_name": display_name,
            "parent_directory": "" if parent_directory == "." else parent_directory,
            "inode": db_file.get("inode"),
            "status_label": status_label,
            "conversion_required": conversion_required,
            "conversion_error": conversion_error,
            "converted": converted,
            "converting": converting,
            "copying": copying,
            "deleted": deleted,
            "percentage_complete": float(db_file.get("percentage_complete") or 0),
            "backend_name": str(db_file.get("backend_name") or "None"),
            "current_size": self._human_readable_file_size(
                db_file.get("current_size") or db_file.get("pre_conversion_size")
            ),
            "pre_conversion_size": self._human_readable_file_size(
                db_file.get("pre_conversion_size") or db_file.get("current_size")
            ),
            "video_duration": self._format_video_duration(format_data.get("duration")),
            "bit_rate": self._format_bit_rate(format_data.get("bit_rate")),
            "video_codec": self._get_codec_name(db_file, "video"),
            "audio_codec": self._get_codec_name(db_file, "audio"),
            "video_streams": int(db_file.get("video_streams") or 0),
            "audio_streams": int(db_file.get("audio_streams") or 0),
            "subtitle_streams": int(db_file.get("subtitle_streams") or 0),
            "start_conversion_time": self._format_datetime(
                db_file.get("start_conversion_time")
            ),
            "end_conversion_time": self._format_datetime(
                db_file.get("end_conversion_time")
            ),
            "can_queue": (not deleted) and (not converted) and (not conversion_required),
            "can_restart_error": (not deleted) and conversion_error,
        }

    async def list_media_files(
        self,
        conversion_required: bool | None = None,
        conversion_error: bool | None = None,
        limit: int = 200,
    ) -> dict[str, Any]:
        if media_collection is None:
            return {"total_count": 0, "files": []}

        query: dict[str, Any] = {"deleted": False}
        if conversion_required is not None:
            query["conversion_required"] = conversion_required
        if conversion_error is not None:
            query["conversion_error"] = conversion_error

        total_count = await media_collection.count_documents(query)
        cursor = media_collection.find(
            query,
            sort=[
                ("conversion_error", DESCENDING),
                ("converting", DESCENDING),
                ("copying", DESCENDING),
                ("conversion_required", DESCENDING),
                ("converted", 1),
                ("current_size", DESCENDING),
                ("filename", 1),
            ],
            projection=[
                "filename",
                "inode",
                "conversion_required",
                "conversion_error",
                "converted",
                "converting",
                "copying",
                "deleted",
                "percentage_complete",
                "backend_name",
                "current_size",
                "pre_conversion_size",
                "video_streams",
                "audio_streams",
                "subtitle_streams",
                "start_conversion_time",
                "end_conversion_time",
                "video_information.streams.codec_type",
                "video_information.streams.codec_name",
                "video_information.format.duration",
                "video_information.format.bit_rate",
            ],
        ).limit(limit)

        db_file_list = await cursor.to_list(length=limit)

        return {
            "total_count": total_count,
            "files": [self._create_media_row(db_file) for db_file in db_file_list],
        }

    async def get_media_file(self, filename: str) -> dict[str, Any] | None:
        if media_collection is None:
            return None

        db_file = await media_collection.find_one({"filename": filename, "deleted": False})
        if db_file is None:
            return None

        return self._serialize_document(db_file)

    async def _update_media_file(
        self,
        filename: str,
        current_filters: Mapping[str, Any],
        updated_fields: Mapping[str, Any],
    ) -> str:
        if media_collection is None:
            return "unavailable"

        query: dict[str, Any] = {"filename": filename, "deleted": False}
        query.update(current_filters)

        result = await media_collection.update_one(query, {"$set": dict(updated_fields)})
        if result.modified_count > 0:
            return "updated"

        existing = await media_collection.find_one(
            {"filename": filename, "deleted": False},
            projection=["filename"],
        )
        if existing is None:
            return "not_found"

        return "not_applicable"

    async def queue_media_file(self, filename: str) -> str:
        return await self._update_media_file(
            filename,
            {"converted": False, "conversion_required": {"$ne": True}},
            {"conversion_required": True},
        )

    async def restart_media_error_file(self, filename: str) -> str:
        return await self._update_media_file(
            filename,
            {"conversion_error": True},
            {"conversion_error": False},
        )