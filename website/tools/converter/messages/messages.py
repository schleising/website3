from enum import Enum

from pydantic import BaseModel

class MessageTypes(str, Enum):
    CONVERTING_FILES = "converting_files"
    FILES_TO_CONVERT = "files_to_convert"
    CONVERTED_FILES = "converted_files"
    STATISTICS = "statistics"

class ConvertingFileData(BaseModel):
    filename: str
    display_title: str
    media_kind: str
    cover_art_url: str
    cover_art_status: str = "pending"
    cover_art_key: str = ""
    progress: float
    time_since_start: str
    time_remaining: str
    backend_name: str
    speed: float | None = None
    copying: bool | None = None
    estimated_percentage_saved: int | None = None

class ConvertingFilesMessage(BaseModel):
    converting_files: list[ConvertingFileData]

class ConvertedFileData(BaseModel):
    file_data_id: str
    filename: str
    display_title: str
    media_kind: str
    cover_art_url: str
    cover_art_status: str = "pending"
    cover_art_key: str = ""
    start_conversion_time: str
    end_conversion_time: str
    total_conversion_time: str
    pre_conversion_size: str
    current_size: str
    percentage_saved: int

class ConvertedFilesMessage(BaseModel):
    converted_files: list[ConvertedFileData]

class FileToConvertData(BaseModel):
    file_data_id: str
    filename: str
    display_title: str
    media_kind: str
    cover_art_url: str
    cover_art_status: str = "pending"
    cover_art_key: str = ""
    queue_status: str = "queued"
    current_size: str
    estimated_size_after_conversion: str
    estimated_percentage_saved: int
    prediction_confidence: str
    bit_rate: str
    video_codec: str
    audio_codec: str
    video_duration: str

class FilesToConvertMessage(BaseModel):
    files_to_convert: list[FileToConvertData]

class StatisticsMessage(BaseModel):
    total_files: int
    total_converted: int
    total_to_convert: int
    gigabytes_before_conversion: float
    gigabytes_after_conversion: float
    gigabytes_saved: float
    percentage_saved: int
    total_conversion_time: str
    total_size_before_conversion_tb: float
    total_size_after_conversion_tb: float
    films_converted: int
    films_to_convert: int
    tv_converted: int
    tv_to_convert: int
    converted_media_mix: str
    queue_media_mix: str
    conversion_errors: int
    conversions_by_backend: dict[str, int]

class Message(BaseModel):
    messageType: MessageTypes
    messageBody: ConvertingFilesMessage | ConvertedFilesMessage | FilesToConvertMessage | StatisticsMessage | None
