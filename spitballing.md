


Structure of a cam operation in CL Data format

Setup:
 - Origin
 - Operation
    - Drive Geometry
    - Feeds, Speeds, Depth
    - Tool
    - 
    - Moves[]:
        - Move:
            - Type (travel, approach, engage, cut, retract, departure)
            - Feedrate (int | None) if travel
            - X, Y, Z
            - Vector (optional)
