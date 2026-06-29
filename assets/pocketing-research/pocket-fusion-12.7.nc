%
(pocket-fusion-12.7)
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

(2D Pocket1)
T1
M3 S5000
G17 G90 G94
M8
G0 X5.376 Y-14.951
Z15
G1 Z5 F1000
Z2.5 F333.3
Z-4.762
X0 Y-4.199 F1000
X-9.725 Y-23.65
X9.725
X5.376 Y-14.951
Z5
X0 Y23.65
Z2.5 F333.3
Z-4.762
X-9.725 F1000
X0 Y4.199
X5.379 Y14.957
X9.725 Y23.65
X0
Z15
M9
G28 G91 Z0
G90
G28 G91 X0 Y0
G90
M0
%
