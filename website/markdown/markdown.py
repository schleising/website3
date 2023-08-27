from datetime import datetime
from bson import ObjectId

from pymongo.results import UpdateResult
from pymongo.errors import DuplicateKeyError, WriteError

from markdown import markdown

from fastapi.encoders import jsonable_encoder

from ..account.user_model import User

from .models import MarkdownDataMessage, MarkdownResponse, MarkdownDataToDb, MarkdownDataFromDb, BlogId, BlogList, BlogResponse

from . import markdown_collection

async def convert_to_markdown(data_to_convert: MarkdownDataMessage, user: User | None) -> MarkdownResponse:
    # Convert the markdown text to formatted text
    converted_text = markdown(data_to_convert.text, extensions=[
        'markdown.extensions.admonition',
        'pymdownx.extra',
        'md_mermaid',
    ])

    # Indicates whether data has been saved to the DB
    data_saved = None

    # Check whether the data should be saved to the DB
    if data_to_convert.save_data and user is not None:
        if markdown_collection is not None:
            # Create a database type
            db_input = MarkdownDataToDb(**data_to_convert.model_dump(), username=user.username, last_updated=datetime.utcnow())

            try:
                # Add the data to the database
                result: UpdateResult = await markdown_collection.replace_one({'title': data_to_convert.title, 'username': user.username}, jsonable_encoder(db_input), upsert=True)

                # If the transaction was successful, set data_savedd to True
                if result.modified_count > 0 or result.upserted_id is not None:
                    data_saved = True
                else:
                    data_saved = False
            except DuplicateKeyError:
                data_saved = False
            except WriteError:
                data_saved = False

    # Create a response message
    response_msg = MarkdownResponse(
        markdown_text = converted_text,
        data_saved = data_saved
    )

    return response_msg

async def get_blog_list(user: User | None) -> BlogList:
    if markdown_collection is not None and user is not None:
        # Get all blogs
        blog_cursor = markdown_collection.find({})

        # Convert the list to a Markdown Data From DB type, so we can check the user
        blog_list = [MarkdownDataFromDb(**blog_id) async for blog_id in blog_cursor]

        # Filter out posts which are not by this user
        blog_list = [BlogId(id=str(blog_id.id), title=blog_id.title) for blog_id in blog_list if blog_id.username == user.username]

        # Return the blog list
        return BlogList(blog_ids=blog_list)

    # Return an empty list
    return BlogList(blog_ids=[])

async def get_blog_text(blog_id: str) -> BlogResponse:
    if markdown_collection is not None:
        # Get the blog entry
        item_db = await markdown_collection.find_one({'_id': ObjectId(blog_id)})

        # Convert it to a response
        if item_db is not None:
            markdown_data = BlogResponse(**item_db)
        else:
            markdown_data = BlogResponse()

        # Return the response
        return markdown_data

    # Return an empty repsonse
    return BlogResponse()
