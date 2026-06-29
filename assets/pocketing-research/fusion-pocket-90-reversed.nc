%
(fusion-pocket-90-reversed)
(T1 D=12.7 CR=0 - ZMIN=-4.762 - flat end mill)
G90
G17
G21
(When using Fusion for Personal Use, the feedrate of rapid)
(moves is reduced to match the feedrate of cutting moves,)
(which can increase machining time. Unrestricted rapid moves)
(are available with a Fusion Subscription.)
G28 G91 Z0
G90

(2D Pocket1 2)
T1
M3 S5000
G17 G90 G94
M8
G0 X-14.951 Y-5.376
Z15
G1 Z5 F1000
Z2.5 F333.3
Z-4.762
X-23.65 Y-9.725 F1000
Y9.725
X-4.199 Y0
X-14.951 Y-5.376
Z5
X23.65 Y0
Z2.5 F333.3
Z-4.762
Y-9.725 F1000
X4.199 Y0
X14.954 Y5.377
X23.65 Y9.725
Y0
Z15
M9
G28 G91 Z0
G90
G28 G91 X0 Y0
G90
M0
%
