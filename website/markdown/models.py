from datetime import datetime
from enum import Enum
from typing import Annotated, Any
from bson import ObjectId

from pydantic import BaseModel, Field

from ..database.models import ObjectIdPydanticAnnotation

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

class BlogEntry(MarkdownDataToDb):
    first_name: str = ""
    last_name: str = ""

class MarkdownDataFromDb(MarkdownDataToDb):
    id: Annotated[ObjectId, ObjectIdPydanticAnnotation] = Field(..., alias='_id')

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
