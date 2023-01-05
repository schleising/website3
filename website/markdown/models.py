from enum import Enum
from pydantic import BaseModel

class MessageType(str, Enum):
    MarkdownMessage = 'MarkdownMessage'
    SaveMessage = 'SaveMessage'

class DataToConvert(BaseModel):
    save_data: bool
    text: str
    username: str | None
