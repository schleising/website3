FROM python:3.11-alpine

COPY ./requirements.txt /requirements.txt

RUN pip install -r /requirements.txt

CMD [ "uvicorn", "app.index:app", "--uds", "/socket/uvicorn.sock" ]
