from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


def _normalise_optional_client_id(value: Any) -> str | None:
    if not isinstance(value, str):
        return None

    candidate = value.strip()
    return candidate if candidate != "" else None


class SystemNotificationTopic(BaseModel):
    id: str
    label: str
    description: str


SYSTEM_NOTIFICATION_TOPICS: tuple[SystemNotificationTopic, ...] = (
    SystemNotificationTopic(
        id="dyn_dns_success",
        label="DNS update succeeded",
        description="Sent when the Cloudflare A-record is updated after an external IP change.",
    ),
    SystemNotificationTopic(
        id="dyn_dns_failure",
        label="DNS update failed",
        description="Sent when the Cloudflare A-record update fails after an external IP change.",
    ),
)

SYSTEM_NOTIFICATION_TOPIC_IDS: frozenset[str] = frozenset(
    topic.id for topic in SYSTEM_NOTIFICATION_TOPICS
)


class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscription(BaseModel):
    endpoint: str
    expiration_time: int | None = Field(
        default=None,
        validation_alias=AliasChoices("expiration_time", "expirationTime"),
        serialization_alias="expirationTime",
    )
    keys: PushSubscriptionKeys

    model_config = ConfigDict(populate_by_name=True)


class SystemPushSubscriptionDocument(BaseModel):
    subscription: PushSubscription
    topics: list[str] = Field(default_factory=list)
    username: str = "Anonymous User"
    client_id: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @field_validator("client_id", mode="before")
    @classmethod
    def normalise_client_id(cls, value: Any) -> str | None:
        return _normalise_optional_client_id(value)

    @field_validator("topics", mode="before")
    @classmethod
    def normalise_topics(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise TypeError("topics must be a list of strings")
        return [str(topic).strip() for topic in value if str(topic).strip() != ""]


class SystemSubscriptionClientIdentity(BaseModel):
    client_id: str | None = None

    @field_validator("client_id", mode="before")
    @classmethod
    def normalise_client_id(cls, value: Any) -> str | None:
        return _normalise_optional_client_id(value)


class SystemSubscriptionUpdateRequest(SystemSubscriptionClientIdentity):
    subscription: PushSubscription
    topics: list[str] = Field(default_factory=list)

    @field_validator("topics", mode="before")
    @classmethod
    def normalise_topics(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise TypeError("topics must be a list of strings")
        return [str(topic).strip() for topic in value if str(topic).strip() != ""]


class SystemSubscriptionDeleteRequest(SystemSubscriptionClientIdentity):
    subscription: PushSubscription | None = None

    @model_validator(mode="after")
    def require_lookup_key(self) -> SystemSubscriptionDeleteRequest:
        if self.subscription is None and self.client_id is None:
            raise ValueError("Either subscription or client_id is required.")
        return self


class SystemSubscriptionPreferencesResponse(BaseModel):
    is_subscribed: bool
    topics: list[str] = Field(default_factory=list)


class SystemSubscriptionOperationResponse(BaseModel):
    status: str
    message: str
    topics: list[str] = Field(default_factory=list)
