# Start with the Python Alpine image
FROM python:3.11-alpine

# Add the required packages, disabling cache to reduce the size of the image
COPY ./requirements.txt /requirements.txt
RUN pip install --no-cache-dir -r /requirements.txt

# Set the entrypoint to run uvicorn with a socket connection
CMD [ "uvicorn", "app.index:app", "--uds", "/socket/uvicorn.sock" ]
