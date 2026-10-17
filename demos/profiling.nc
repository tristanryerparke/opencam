; Rhino profiling
; Machine: Duet 3D CNC
G21
G90
G17
G54
M98 P"0:/macros/dust_on.g"

; Operation 1
; Tool 3: 1 inch flat end mill
T3
G0 Z50
M3 S18000
G4 S3
G0 X4.7 Y4.7 Z50 ; start at clearance plane
Z0 ; move to operation start
G1 Y985.3 F800
X982.3
Y4.7
X4.7
G0 Z50 ; return to clearance plane
M5
M98 P"0:/macros/dust_off.g"
; End OpenCAM program
