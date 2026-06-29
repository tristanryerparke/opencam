
The backend can host a tool and material library, maybe even a preset operations library. These are stored in a database.

There can be some unification of the rhino and web interfaces by generating the tab sections of the configuration pages, and the form-like content of each page with json schemas defined by pydantic models in the backend.

#### All Setups
- Origin
- Orientation (which way machine Z is pointing)
- Stock
- Operations

#### All 2D Operations
- Material / Feeds & Speeds
- Tool
	- Diameter
	- Flute Length
	- Tool #
	- Manual Change (y/n)
- Clearence Settings
	- Clearence Plane Height
	- Transfer height (clearence plane or stock max Z + X)
- Heights & Levels
	- Drive geo at top/bottom
	- Height of cut
	- Max cut depth
- Advanced Parameters
	- Operation Sorting (default shortest travel distance traveling salesman)
	- Cut transitions
	- Layer order (per area or per layer)


#### 2D Pocketing
- Drive Geometry (closed curves, closed surface edge)
- Cut Parameters
	- Stepover
	- Stock to leave
	- Pocket from inside / outside