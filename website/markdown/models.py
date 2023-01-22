from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from ..database.models import PyObjectId

class MessageType(int, Enum):
    MARKDOWN_UPDATE = 1
    GET_BLOG_LIST = 2
    GET_BLOG_TEXT = 3

class BaseMessage(BaseModel):
    message_type: int
    body: dict[str, Any]

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

class BlogId(BaseModel):
    id: str
    title: str

class BlogList(BaseModel):
    blog_ids: list[BlogId] = []

class BlogRequest(BaseModel):
    id: str

class BlogResponse(BaseModel):
    id: str = ''
    title: str = ''
    text: str = ''
