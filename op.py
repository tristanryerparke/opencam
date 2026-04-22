



from base import CamelBaseModel
from models import Tool


class BaseOperation(CamelBaseModel):
    tool: Tool
    feedrate: float
    rpm: int

