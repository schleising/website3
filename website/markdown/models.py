from datetime import datetime
from enum import Enum
from pydantic import BaseModel

class MessageType(str, Enum):
    MarkdownMessage = 'MarkdownMessage'
    SaveMessage = 'SaveMessage'

class MarkdownData(BaseModel):
    title: str
    text: str

class MarkdownDataMessage(MarkdownData):
    save_data: bool

class MarkdownDataInDb(MarkdownData):
    username: str
    last_updated: datetime

class MarkdownResponse(BaseModel):
    markdown_text: str
    data_saved: bool
