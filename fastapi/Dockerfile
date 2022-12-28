FROM python:3.11-alpine

RUN mkdir /app

COPY ./requirements.txt /app/requirements.txt

RUN pip install -r /app/requirements.txt

COPY ./website /app

CMD [ "uvicorn", "app.index:app", "--host", "website3-api-1" ]
