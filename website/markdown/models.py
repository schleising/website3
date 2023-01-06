from datetime import datetime
from enum import Enum
# from bson.objectid import ObjectId

from pydantic import BaseModel, Field

from ..database.models import PyObjectId

class MessageType(str, Enum):
    MarkdownMessage = 'MarkdownMessage'
    SaveMessage = 'SaveMessage'

class MarkdownData(BaseModel):
    title: str
    text: str

class MarkdownDataMessage(MarkdownData):
    save_data: bool

class MarkdownDataToDb(MarkdownData):
    username: str
    last_updated: datetime

class MarkdownDataFromDb(MarkdownDataToDb):
    id: PyObjectId = Field(default_factory=PyObjectId, alias='_id')

    class Config:
        allow_population_by_field_name = True
        arbitrary_types_allowed = True
        json_encoders = {PyObjectId: str}

class MarkdownResponse(BaseModel):
    markdown_text: str
    data_saved: bool | None
