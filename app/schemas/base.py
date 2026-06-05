
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelBaseModel(BaseModel):
    """The frontend uses camel case for its keys, this class handles
    automatic serialization and deserialization to and from camel case"""

    model_config = ConfigDict(
        alias_generator=to_camel,
        serialize_by_alias=True,
        populate_by_name=True,
    )