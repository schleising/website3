from pydantic import BaseModel
from enum import Enum

class MessageTypes(str, Enum):
    CONVERTING_FILES = "converting_files"
    FILES_TO_CONVERT = "files_to_convert"
    CONVERTED_FILES = "converted_files"
    STATISTICS = "statistics"

class ConvertingFileData(BaseModel):
    filename: str
    progress: float
    time_since_start: str
    time_remaining: str
    backend_name: str
    speed: float | None = None
    copying: bool | None = None

class ConvertingFilesMessage(BaseModel):
    converting_files: list[ConvertingFileData]

class ConvertedFileData(BaseModel):
    filename: str
    percentage_saved: float

class ConvertedFilesMessage(BaseModel):
    converted_files: list[ConvertedFileData]

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
    conversion_errors: int
    conversions_by_backend: dict[str, int]

class Message(BaseModel):
    messageType: MessageTypes
    messageBody: ConvertingFilesMessage | ConvertedFilesMessage | StatisticsMessage | None
