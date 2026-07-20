/**
 * This file is auto-generated from Python Pydantic models.
 * Do not edit it by hand.
 */
export const camSchemaBundle = {
  "generateToolpathRequest": {
    "$defs": {
      "AbsoluteClearance": {
        "properties": {
          "clearanceHeightType": {
            "const": "absolute",
            "default": "absolute",
            "title": "Clearanceheighttype",
            "type": "string"
          },
          "absoluteHeight": {
            "default": 25.4,
            "title": "Absolute height",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "AbsoluteClearance",
        "type": "object"
      },
      "BallTool": {
        "properties": {
          "id": {
            "title": "Id",
            "type": "string"
          },
          "name": {
            "title": "Name",
            "type": "string"
          },
          "toolNumber": {
            "title": "Toolnumber",
            "type": "integer"
          },
          "manualChange": {
            "default": false,
            "title": "Manualchange",
            "type": "boolean"
          },
          "diameter": {
            "title": "Diameter",
            "type": "number"
          },
          "cuttingHeight": {
            "title": "Cuttingheight",
            "type": "number"
          },
          "shoulderHeight": {
            "title": "Shoulderheight",
            "type": "number"
          },
          "numFlutes": {
            "default": 2,
            "title": "Numflutes",
            "type": "number"
          },
          "type": {
            "const": "ball",
            "default": "ball",
            "title": "Type",
            "type": "string"
          }
        },
        "required": [
          "name",
          "toolNumber",
          "diameter",
          "cuttingHeight",
          "shoulderHeight"
        ],
        "title": "BallTool",
        "type": "object"
      },
      "CAMAdvancedParameters": {
        "properties": {
          "operationsSorting": {
            "default": "shortest_distance",
            "enum": [
              "selection",
              "shortest_distance"
            ],
            "title": "Operation sorting",
            "type": "string"
          },
          "chordalTolerance": {
            "default": 0.01,
            "exclusiveMinimum": 0,
            "title": "Chordal tolerance",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "CAMAdvancedParameters",
        "type": "object"
      },
      "CAMLevels": {
        "properties": {
          "driveGeometryPosition": {
            "default": "at_bottom",
            "enum": [
              "at_top",
              "at_bottom"
            ],
            "title": "Drive geometry at",
            "type": "string"
          },
          "depthOfCut": {
            "default": 5,
            "exclusiveMinimum": 0,
            "title": "Depth of cut",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          },
          "maxStepdown": {
            "default": 20,
            "exclusiveMinimum": 0,
            "title": "Max stepdown",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "CAMLevels",
        "type": "object"
      },
      "CAMSetup": {
        "properties": {
          "origin": {
            "$ref": "#/$defs/SetupOrigin",
            "title": "Origin"
          },
          "orientation": {
            "$ref": "#/$defs/SetupOrientation",
            "title": "Orientation"
          },
          "stock": {
            "$ref": "#/$defs/SetupStock",
            "title": "Stock"
          }
        },
        "title": "CAMSetup",
        "type": "object"
      },
      "ClosedPolyline25D": {
        "properties": {
          "kind": {
            "const": "closed_polyline",
            "default": "closed_polyline",
            "title": "Kind",
            "type": "string"
          },
          "vertices": {
            "items": {
              "$ref": "#/$defs/Point2D"
            },
            "title": "Vertices",
            "type": "array"
          },
          "z": {
            "title": "Z",
            "type": "number"
          }
        },
        "required": [
          "vertices",
          "z"
        ],
        "title": "ClosedPolyline25D",
        "type": "object"
      },
      "CylindricalTool": {
        "properties": {
          "id": {
            "title": "Id",
            "type": "string"
          },
          "name": {
            "title": "Name",
            "type": "string"
          },
          "toolNumber": {
            "title": "Toolnumber",
            "type": "integer"
          },
          "manualChange": {
            "default": false,
            "title": "Manualchange",
            "type": "boolean"
          },
          "diameter": {
            "title": "Diameter",
            "type": "number"
          },
          "cuttingHeight": {
            "title": "Cuttingheight",
            "type": "number"
          },
          "shoulderHeight": {
            "title": "Shoulderheight",
            "type": "number"
          },
          "numFlutes": {
            "default": 2,
            "title": "Numflutes",
            "type": "number"
          },
          "type": {
            "const": "cylinder",
            "default": "cylinder",
            "title": "Type",
            "type": "string"
          }
        },
        "required": [
          "name",
          "toolNumber",
          "diameter",
          "cuttingHeight",
          "shoulderHeight"
        ],
        "title": "CylindricalTool",
        "type": "object"
      },
      "FeedsAndSpeeds": {
        "properties": {
          "spindleRpm": {
            "default": 12000,
            "exclusiveMinimum": 0,
            "title": "Spindle RPM",
            "type": "integer"
          },
          "plungeFeedrate": {
            "default": 250,
            "exclusiveMinimum": 0,
            "title": "Plunge feedrate",
            "type": "number",
            "x-opencam": {
              "unit": "mm/min"
            }
          },
          "leadInFeedrate": {
            "default": 500,
            "exclusiveMinimum": 0,
            "title": "Lead-in feedrate",
            "type": "number",
            "x-opencam": {
              "unit": "mm/min"
            }
          },
          "cutFeedrate": {
            "default": 500,
            "exclusiveMinimum": 0,
            "title": "Cut feedrate",
            "type": "number",
            "x-opencam": {
              "unit": "mm/min"
            }
          },
          "leadOutFeedrate": {
            "default": 500,
            "exclusiveMinimum": 0,
            "title": "Lead-out feedrate",
            "type": "number",
            "x-opencam": {
              "unit": "mm/min"
            }
          },
          "departureFeedrate": {
            "default": 500,
            "exclusiveMinimum": 0,
            "title": "Departure feedrate",
            "type": "number",
            "x-opencam": {
              "unit": "mm/min"
            }
          }
        },
        "title": "FeedsAndSpeeds",
        "type": "object"
      },
      "PartMaxZPlusOffsetClearance": {
        "properties": {
          "clearanceHeightType": {
            "const": "part_max_z_plus_offset",
            "default": "part_max_z_plus_offset",
            "title": "Clearanceheighttype",
            "type": "string"
          },
          "offset": {
            "default": 5,
            "minimum": 0,
            "title": "Offset",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "PartMaxZPlusOffsetClearance",
        "type": "object"
      },
      "Pocketing2dOp": {
        "properties": {
          "type": {
            "const": "pocketing_2d",
            "default": "pocketing_2d",
            "title": "Type",
            "type": "string"
          },
          "id": {
            "title": "Operation ID",
            "type": "string"
          },
          "displayName": {
            "default": "2D Pocket",
            "title": "Operation name",
            "type": "string"
          },
          "tool": {
            "discriminator": {
              "mapping": {
                "ball": "#/$defs/BallTool",
                "cylinder": "#/$defs/CylindricalTool",
                "v": "#/$defs/VTool"
              },
              "propertyName": "type"
            },
            "oneOf": [
              {
                "$ref": "#/$defs/CylindricalTool"
              },
              {
                "$ref": "#/$defs/BallTool"
              },
              {
                "$ref": "#/$defs/VTool"
              }
            ],
            "title": "Tool"
          },
          "feedsAndSpeeds": {
            "$ref": "#/$defs/FeedsAndSpeeds",
            "title": "Feeds and speeds"
          },
          "clearance": {
            "discriminator": {
              "mapping": {
                "absolute": "#/$defs/AbsoluteClearance",
                "part_max_z_plus_offset": "#/$defs/PartMaxZPlusOffsetClearance",
                "stock_max_z_plus_offset": "#/$defs/StockMaxZPlusOffsetClearance"
              },
              "propertyName": "clearanceHeightType"
            },
            "oneOf": [
              {
                "$ref": "#/$defs/AbsoluteClearance"
              },
              {
                "$ref": "#/$defs/StockMaxZPlusOffsetClearance"
              },
              {
                "$ref": "#/$defs/PartMaxZPlusOffsetClearance"
              }
            ],
            "title": "Clearance"
          },
          "levels": {
            "$ref": "#/$defs/CAMLevels",
            "title": "Levels"
          },
          "advanced": {
            "$ref": "#/$defs/CAMAdvancedParameters",
            "title": "Advanced"
          },
          "driveGeometry": {
            "$ref": "#/$defs/PocketingDriveGeometry",
            "title": "Drive geometry"
          },
          "cutParameters": {
            "$ref": "#/$defs/PocketingCutSettings",
            "title": "Cut parameters"
          }
        },
        "required": [
          "tool",
          "driveGeometry"
        ],
        "title": "Pocketing2dOp",
        "type": "object"
      },
      "PocketingCutSettings": {
        "properties": {
          "cutDirection": {
            "default": "climb",
            "enum": [
              "climb",
              "conventional"
            ],
            "title": "Climb/Conventional",
            "type": "string"
          },
          "stepover": {
            "$ref": "#/$defs/StepoverMode",
            "title": "Stepover"
          },
          "stockToLeave": {
            "default": 0,
            "minimum": 0,
            "title": "Stock to leave",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "PocketingCutSettings",
        "type": "object"
      },
      "PocketingDriveGeometry": {
        "properties": {
          "cutAreas": {
            "items": {
              "$ref": "#/$defs/ClosedPolyline25D"
            },
            "minItems": 1,
            "title": "Cut areas",
            "type": "array"
          }
        },
        "required": [
          "cutAreas"
        ],
        "title": "PocketingDriveGeometry",
        "type": "object"
      },
      "Point2D": {
        "properties": {
          "x": {
            "title": "X",
            "type": "number"
          },
          "y": {
            "title": "Y",
            "type": "number"
          }
        },
        "required": [
          "x",
          "y"
        ],
        "title": "Point2D",
        "type": "object"
      },
      "Polyline25D": {
        "properties": {
          "kind": {
            "const": "polyline",
            "default": "polyline",
            "title": "Kind",
            "type": "string"
          },
          "vertices": {
            "items": {
              "$ref": "#/$defs/Point2D"
            },
            "title": "Vertices",
            "type": "array"
          },
          "z": {
            "title": "Z",
            "type": "number"
          }
        },
        "required": [
          "vertices",
          "z"
        ],
        "title": "Polyline25D",
        "type": "object"
      },
      "Profiling2dOp": {
        "properties": {
          "type": {
            "const": "profiling_2d",
            "default": "profiling_2d",
            "title": "Type",
            "type": "string"
          },
          "id": {
            "title": "Operation ID",
            "type": "string"
          },
          "displayName": {
            "default": "2D Profile",
            "title": "Operation name",
            "type": "string"
          },
          "tool": {
            "discriminator": {
              "mapping": {
                "ball": "#/$defs/BallTool",
                "cylinder": "#/$defs/CylindricalTool",
                "v": "#/$defs/VTool"
              },
              "propertyName": "type"
            },
            "oneOf": [
              {
                "$ref": "#/$defs/CylindricalTool"
              },
              {
                "$ref": "#/$defs/BallTool"
              },
              {
                "$ref": "#/$defs/VTool"
              }
            ],
            "title": "Tool"
          },
          "feedsAndSpeeds": {
            "$ref": "#/$defs/FeedsAndSpeeds",
            "title": "Feeds and speeds"
          },
          "clearance": {
            "discriminator": {
              "mapping": {
                "absolute": "#/$defs/AbsoluteClearance",
                "part_max_z_plus_offset": "#/$defs/PartMaxZPlusOffsetClearance",
                "stock_max_z_plus_offset": "#/$defs/StockMaxZPlusOffsetClearance"
              },
              "propertyName": "clearanceHeightType"
            },
            "oneOf": [
              {
                "$ref": "#/$defs/AbsoluteClearance"
              },
              {
                "$ref": "#/$defs/StockMaxZPlusOffsetClearance"
              },
              {
                "$ref": "#/$defs/PartMaxZPlusOffsetClearance"
              }
            ],
            "title": "Clearance"
          },
          "levels": {
            "$ref": "#/$defs/CAMLevels",
            "title": "Levels"
          },
          "advanced": {
            "$ref": "#/$defs/CAMAdvancedParameters",
            "title": "Advanced"
          },
          "driveGeometry": {
            "$ref": "#/$defs/ProfilingDriveGeometry",
            "title": "Drive geometry"
          },
          "cutParameters": {
            "$ref": "#/$defs/ProfilingCutSettings",
            "title": "Cut parameters"
          }
        },
        "required": [
          "tool",
          "driveGeometry"
        ],
        "title": "Profiling2dOp",
        "type": "object"
      },
      "ProfilingCutSettings": {
        "properties": {
          "side": {
            "default": "outside",
            "enum": [
              "outside",
              "inside"
            ],
            "title": "Side",
            "type": "string"
          },
          "cutDirection": {
            "default": "climb",
            "enum": [
              "climb",
              "conventional"
            ],
            "title": "Climb/Conventional",
            "type": "string"
          },
          "stockToLeave": {
            "default": 0,
            "minimum": 0,
            "title": "Stock to leave",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "ProfilingCutSettings",
        "type": "object"
      },
      "ProfilingDriveGeometry": {
        "properties": {
          "profiles": {
            "items": {
              "anyOf": [
                {
                  "$ref": "#/$defs/ClosedPolyline25D"
                },
                {
                  "$ref": "#/$defs/Polyline25D"
                }
              ]
            },
            "minItems": 1,
            "title": "Profiles",
            "type": "array"
          }
        },
        "required": [
          "profiles"
        ],
        "title": "ProfilingDriveGeometry",
        "type": "object"
      },
      "SetupOrientation": {
        "properties": {
          "machineZAxis": {
            "const": "positiveZ",
            "default": "positiveZ",
            "description": "Current UI assumes a normally oriented setup with machine Z pointing up.",
            "title": "Machine Z axis",
            "type": "string"
          }
        },
        "title": "SetupOrientation",
        "type": "object"
      },
      "SetupOrigin": {
        "properties": {
          "x": {
            "default": 0,
            "title": "Origin X",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          },
          "y": {
            "default": 0,
            "title": "Origin Y",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          },
          "z": {
            "default": 0,
            "title": "Origin Z",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "SetupOrigin",
        "type": "object"
      },
      "SetupStock": {
        "properties": {
          "maxZ": {
            "default": 0,
            "description": "Used when clearance height is computed from stock height.",
            "title": "Stock max Z",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "SetupStock",
        "type": "object"
      },
      "StepoverMode": {
        "properties": {
          "mode": {
            "default": "percentage_of_tool_diameter",
            "enum": [
              "percentage_of_tool_diameter",
              "absolute"
            ],
            "title": "Mode",
            "type": "string"
          },
          "value": {
            "default": 25,
            "exclusiveMinimum": 0,
            "title": "Value",
            "type": "number",
            "x-opencam": {
              "unit": "%"
            }
          }
        },
        "title": "StepoverMode",
        "type": "object"
      },
      "StockMaxZPlusOffsetClearance": {
        "properties": {
          "clearanceHeightType": {
            "const": "stock_max_z_plus_offset",
            "default": "stock_max_z_plus_offset",
            "title": "Clearanceheighttype",
            "type": "string"
          },
          "offset": {
            "default": 5,
            "minimum": 0,
            "title": "Offset",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "StockMaxZPlusOffsetClearance",
        "type": "object"
      },
      "VTool": {
        "properties": {
          "id": {
            "title": "Id",
            "type": "string"
          },
          "name": {
            "title": "Name",
            "type": "string"
          },
          "toolNumber": {
            "title": "Toolnumber",
            "type": "integer"
          },
          "manualChange": {
            "default": false,
            "title": "Manualchange",
            "type": "boolean"
          },
          "diameter": {
            "title": "Diameter",
            "type": "number"
          },
          "cuttingHeight": {
            "title": "Cuttingheight",
            "type": "number"
          },
          "shoulderHeight": {
            "title": "Shoulderheight",
            "type": "number"
          },
          "numFlutes": {
            "default": 2,
            "title": "Numflutes",
            "type": "number"
          },
          "type": {
            "const": "v",
            "default": "v",
            "title": "Type",
            "type": "string"
          },
          "tipAngle": {
            "title": "Tipangle",
            "type": "number"
          }
        },
        "required": [
          "name",
          "toolNumber",
          "diameter",
          "cuttingHeight",
          "shoulderHeight",
          "tipAngle"
        ],
        "title": "VTool",
        "type": "object"
      }
    },
    "properties": {
      "setup": {
        "$ref": "#/$defs/CAMSetup",
        "title": "Setup"
      },
      "operation": {
        "discriminator": {
          "mapping": {
            "pocketing_2d": "#/$defs/Pocketing2dOp",
            "profiling_2d": "#/$defs/Profiling2dOp"
          },
          "propertyName": "type"
        },
        "oneOf": [
          {
            "$ref": "#/$defs/Pocketing2dOp"
          },
          {
            "$ref": "#/$defs/Profiling2dOp"
          }
        ],
        "title": "Operation"
      }
    },
    "required": [
      "operation"
    ],
    "title": "GenerateToolpathRequest",
    "type": "object"
  },
  "pocket2dOperation": {
    "$defs": {
      "AbsoluteClearance": {
        "properties": {
          "clearanceHeightType": {
            "const": "absolute",
            "default": "absolute",
            "title": "Clearanceheighttype",
            "type": "string"
          },
          "absoluteHeight": {
            "default": 25.4,
            "title": "Absolute height",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "AbsoluteClearance",
        "type": "object"
      },
      "BallTool": {
        "properties": {
          "id": {
            "title": "Id",
            "type": "string"
          },
          "name": {
            "title": "Name",
            "type": "string"
          },
          "toolNumber": {
            "title": "Toolnumber",
            "type": "integer"
          },
          "manualChange": {
            "default": false,
            "title": "Manualchange",
            "type": "boolean"
          },
          "diameter": {
            "title": "Diameter",
            "type": "number"
          },
          "cuttingHeight": {
            "title": "Cuttingheight",
            "type": "number"
          },
          "shoulderHeight": {
            "title": "Shoulderheight",
            "type": "number"
          },
          "numFlutes": {
            "default": 2,
            "title": "Numflutes",
            "type": "number"
          },
          "type": {
            "const": "ball",
            "default": "ball",
            "title": "Type",
            "type": "string"
          }
        },
        "required": [
          "name",
          "toolNumber",
          "diameter",
          "cuttingHeight",
          "shoulderHeight"
        ],
        "title": "BallTool",
        "type": "object"
      },
      "CAMAdvancedParameters": {
        "properties": {
          "operationsSorting": {
            "default": "shortest_distance",
            "enum": [
              "selection",
              "shortest_distance"
            ],
            "title": "Operation sorting",
            "type": "string"
          },
          "chordalTolerance": {
            "default": 0.01,
            "exclusiveMinimum": 0,
            "title": "Chordal tolerance",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "CAMAdvancedParameters",
        "type": "object"
      },
      "CAMLevels": {
        "properties": {
          "driveGeometryPosition": {
            "default": "at_bottom",
            "enum": [
              "at_top",
              "at_bottom"
            ],
            "title": "Drive geometry at",
            "type": "string"
          },
          "depthOfCut": {
            "default": 5,
            "exclusiveMinimum": 0,
            "title": "Depth of cut",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          },
          "maxStepdown": {
            "default": 20,
            "exclusiveMinimum": 0,
            "title": "Max stepdown",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "CAMLevels",
        "type": "object"
      },
      "ClosedPolyline25D": {
        "properties": {
          "kind": {
            "const": "closed_polyline",
            "default": "closed_polyline",
            "title": "Kind",
            "type": "string"
          },
          "vertices": {
            "items": {
              "$ref": "#/$defs/Point2D"
            },
            "title": "Vertices",
            "type": "array"
          },
          "z": {
            "title": "Z",
            "type": "number"
          }
        },
        "required": [
          "vertices",
          "z"
        ],
        "title": "ClosedPolyline25D",
        "type": "object"
      },
      "CylindricalTool": {
        "properties": {
          "id": {
            "title": "Id",
            "type": "string"
          },
          "name": {
            "title": "Name",
            "type": "string"
          },
          "toolNumber": {
            "title": "Toolnumber",
            "type": "integer"
          },
          "manualChange": {
            "default": false,
            "title": "Manualchange",
            "type": "boolean"
          },
          "diameter": {
            "title": "Diameter",
            "type": "number"
          },
          "cuttingHeight": {
            "title": "Cuttingheight",
            "type": "number"
          },
          "shoulderHeight": {
            "title": "Shoulderheight",
            "type": "number"
          },
          "numFlutes": {
            "default": 2,
            "title": "Numflutes",
            "type": "number"
          },
          "type": {
            "const": "cylinder",
            "default": "cylinder",
            "title": "Type",
            "type": "string"
          }
        },
        "required": [
          "name",
          "toolNumber",
          "diameter",
          "cuttingHeight",
          "shoulderHeight"
        ],
        "title": "CylindricalTool",
        "type": "object"
      },
      "FeedsAndSpeeds": {
        "properties": {
          "spindleRpm": {
            "default": 12000,
            "exclusiveMinimum": 0,
            "title": "Spindle RPM",
            "type": "integer"
          },
          "plungeFeedrate": {
            "default": 250,
            "exclusiveMinimum": 0,
            "title": "Plunge feedrate",
            "type": "number",
            "x-opencam": {
              "unit": "mm/min"
            }
          },
          "leadInFeedrate": {
            "default": 500,
            "exclusiveMinimum": 0,
            "title": "Lead-in feedrate",
            "type": "number",
            "x-opencam": {
              "unit": "mm/min"
            }
          },
          "cutFeedrate": {
            "default": 500,
            "exclusiveMinimum": 0,
            "title": "Cut feedrate",
            "type": "number",
            "x-opencam": {
              "unit": "mm/min"
            }
          },
          "leadOutFeedrate": {
            "default": 500,
            "exclusiveMinimum": 0,
            "title": "Lead-out feedrate",
            "type": "number",
            "x-opencam": {
              "unit": "mm/min"
            }
          },
          "departureFeedrate": {
            "default": 500,
            "exclusiveMinimum": 0,
            "title": "Departure feedrate",
            "type": "number",
            "x-opencam": {
              "unit": "mm/min"
            }
          }
        },
        "title": "FeedsAndSpeeds",
        "type": "object"
      },
      "PartMaxZPlusOffsetClearance": {
        "properties": {
          "clearanceHeightType": {
            "const": "part_max_z_plus_offset",
            "default": "part_max_z_plus_offset",
            "title": "Clearanceheighttype",
            "type": "string"
          },
          "offset": {
            "default": 5,
            "minimum": 0,
            "title": "Offset",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "PartMaxZPlusOffsetClearance",
        "type": "object"
      },
      "PocketingCutSettings": {
        "properties": {
          "cutDirection": {
            "default": "climb",
            "enum": [
              "climb",
              "conventional"
            ],
            "title": "Climb/Conventional",
            "type": "string"
          },
          "stepover": {
            "$ref": "#/$defs/StepoverMode",
            "title": "Stepover"
          },
          "stockToLeave": {
            "default": 0,
            "minimum": 0,
            "title": "Stock to leave",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "PocketingCutSettings",
        "type": "object"
      },
      "PocketingDriveGeometry": {
        "properties": {
          "cutAreas": {
            "items": {
              "$ref": "#/$defs/ClosedPolyline25D"
            },
            "minItems": 1,
            "title": "Cut areas",
            "type": "array"
          }
        },
        "required": [
          "cutAreas"
        ],
        "title": "PocketingDriveGeometry",
        "type": "object"
      },
      "Point2D": {
        "properties": {
          "x": {
            "title": "X",
            "type": "number"
          },
          "y": {
            "title": "Y",
            "type": "number"
          }
        },
        "required": [
          "x",
          "y"
        ],
        "title": "Point2D",
        "type": "object"
      },
      "StepoverMode": {
        "properties": {
          "mode": {
            "default": "percentage_of_tool_diameter",
            "enum": [
              "percentage_of_tool_diameter",
              "absolute"
            ],
            "title": "Mode",
            "type": "string"
          },
          "value": {
            "default": 25,
            "exclusiveMinimum": 0,
            "title": "Value",
            "type": "number",
            "x-opencam": {
              "unit": "%"
            }
          }
        },
        "title": "StepoverMode",
        "type": "object"
      },
      "StockMaxZPlusOffsetClearance": {
        "properties": {
          "clearanceHeightType": {
            "const": "stock_max_z_plus_offset",
            "default": "stock_max_z_plus_offset",
            "title": "Clearanceheighttype",
            "type": "string"
          },
          "offset": {
            "default": 5,
            "minimum": 0,
            "title": "Offset",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "StockMaxZPlusOffsetClearance",
        "type": "object"
      },
      "VTool": {
        "properties": {
          "id": {
            "title": "Id",
            "type": "string"
          },
          "name": {
            "title": "Name",
            "type": "string"
          },
          "toolNumber": {
            "title": "Toolnumber",
            "type": "integer"
          },
          "manualChange": {
            "default": false,
            "title": "Manualchange",
            "type": "boolean"
          },
          "diameter": {
            "title": "Diameter",
            "type": "number"
          },
          "cuttingHeight": {
            "title": "Cuttingheight",
            "type": "number"
          },
          "shoulderHeight": {
            "title": "Shoulderheight",
            "type": "number"
          },
          "numFlutes": {
            "default": 2,
            "title": "Numflutes",
            "type": "number"
          },
          "type": {
            "const": "v",
            "default": "v",
            "title": "Type",
            "type": "string"
          },
          "tipAngle": {
            "title": "Tipangle",
            "type": "number"
          }
        },
        "required": [
          "name",
          "toolNumber",
          "diameter",
          "cuttingHeight",
          "shoulderHeight",
          "tipAngle"
        ],
        "title": "VTool",
        "type": "object"
      }
    },
    "properties": {
      "type": {
        "const": "pocketing_2d",
        "default": "pocketing_2d",
        "title": "Type",
        "type": "string"
      },
      "id": {
        "title": "Operation ID",
        "type": "string"
      },
      "displayName": {
        "default": "2D Pocket",
        "title": "Operation name",
        "type": "string"
      },
      "tool": {
        "discriminator": {
          "mapping": {
            "ball": "#/$defs/BallTool",
            "cylinder": "#/$defs/CylindricalTool",
            "v": "#/$defs/VTool"
          },
          "propertyName": "type"
        },
        "oneOf": [
          {
            "$ref": "#/$defs/CylindricalTool"
          },
          {
            "$ref": "#/$defs/BallTool"
          },
          {
            "$ref": "#/$defs/VTool"
          }
        ],
        "title": "Tool"
      },
      "feedsAndSpeeds": {
        "$ref": "#/$defs/FeedsAndSpeeds",
        "title": "Feeds and speeds"
      },
      "clearance": {
        "discriminator": {
          "mapping": {
            "absolute": "#/$defs/AbsoluteClearance",
            "part_max_z_plus_offset": "#/$defs/PartMaxZPlusOffsetClearance",
            "stock_max_z_plus_offset": "#/$defs/StockMaxZPlusOffsetClearance"
          },
          "propertyName": "clearanceHeightType"
        },
        "oneOf": [
          {
            "$ref": "#/$defs/AbsoluteClearance"
          },
          {
            "$ref": "#/$defs/StockMaxZPlusOffsetClearance"
          },
          {
            "$ref": "#/$defs/PartMaxZPlusOffsetClearance"
          }
        ],
        "title": "Clearance"
      },
      "levels": {
        "$ref": "#/$defs/CAMLevels",
        "title": "Levels"
      },
      "advanced": {
        "$ref": "#/$defs/CAMAdvancedParameters",
        "title": "Advanced"
      },
      "driveGeometry": {
        "$ref": "#/$defs/PocketingDriveGeometry",
        "title": "Drive geometry"
      },
      "cutParameters": {
        "$ref": "#/$defs/PocketingCutSettings",
        "title": "Cut parameters"
      }
    },
    "required": [
      "tool",
      "driveGeometry"
    ],
    "title": "Pocketing2dOp",
    "type": "object"
  },
  "profile2dOperation": {
    "$defs": {
      "AbsoluteClearance": {
        "properties": {
          "clearanceHeightType": {
            "const": "absolute",
            "default": "absolute",
            "title": "Clearanceheighttype",
            "type": "string"
          },
          "absoluteHeight": {
            "default": 25.4,
            "title": "Absolute height",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "AbsoluteClearance",
        "type": "object"
      },
      "BallTool": {
        "properties": {
          "id": {
            "title": "Id",
            "type": "string"
          },
          "name": {
            "title": "Name",
            "type": "string"
          },
          "toolNumber": {
            "title": "Toolnumber",
            "type": "integer"
          },
          "manualChange": {
            "default": false,
            "title": "Manualchange",
            "type": "boolean"
          },
          "diameter": {
            "title": "Diameter",
            "type": "number"
          },
          "cuttingHeight": {
            "title": "Cuttingheight",
            "type": "number"
          },
          "shoulderHeight": {
            "title": "Shoulderheight",
            "type": "number"
          },
          "numFlutes": {
            "default": 2,
            "title": "Numflutes",
            "type": "number"
          },
          "type": {
            "const": "ball",
            "default": "ball",
            "title": "Type",
            "type": "string"
          }
        },
        "required": [
          "name",
          "toolNumber",
          "diameter",
          "cuttingHeight",
          "shoulderHeight"
        ],
        "title": "BallTool",
        "type": "object"
      },
      "CAMAdvancedParameters": {
        "properties": {
          "operationsSorting": {
            "default": "shortest_distance",
            "enum": [
              "selection",
              "shortest_distance"
            ],
            "title": "Operation sorting",
            "type": "string"
          },
          "chordalTolerance": {
            "default": 0.01,
            "exclusiveMinimum": 0,
            "title": "Chordal tolerance",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "CAMAdvancedParameters",
        "type": "object"
      },
      "CAMLevels": {
        "properties": {
          "driveGeometryPosition": {
            "default": "at_bottom",
            "enum": [
              "at_top",
              "at_bottom"
            ],
            "title": "Drive geometry at",
            "type": "string"
          },
          "depthOfCut": {
            "default": 5,
            "exclusiveMinimum": 0,
            "title": "Depth of cut",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          },
          "maxStepdown": {
            "default": 20,
            "exclusiveMinimum": 0,
            "title": "Max stepdown",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "CAMLevels",
        "type": "object"
      },
      "ClosedPolyline25D": {
        "properties": {
          "kind": {
            "const": "closed_polyline",
            "default": "closed_polyline",
            "title": "Kind",
            "type": "string"
          },
          "vertices": {
            "items": {
              "$ref": "#/$defs/Point2D"
            },
            "title": "Vertices",
            "type": "array"
          },
          "z": {
            "title": "Z",
            "type": "number"
          }
        },
        "required": [
          "vertices",
          "z"
        ],
        "title": "ClosedPolyline25D",
        "type": "object"
      },
      "CylindricalTool": {
        "properties": {
          "id": {
            "title": "Id",
            "type": "string"
          },
          "name": {
            "title": "Name",
            "type": "string"
          },
          "toolNumber": {
            "title": "Toolnumber",
            "type": "integer"
          },
          "manualChange": {
            "default": false,
            "title": "Manualchange",
            "type": "boolean"
          },
          "diameter": {
            "title": "Diameter",
            "type": "number"
          },
          "cuttingHeight": {
            "title": "Cuttingheight",
            "type": "number"
          },
          "shoulderHeight": {
            "title": "Shoulderheight",
            "type": "number"
          },
          "numFlutes": {
            "default": 2,
            "title": "Numflutes",
            "type": "number"
          },
          "type": {
            "const": "cylinder",
            "default": "cylinder",
            "title": "Type",
            "type": "string"
          }
        },
        "required": [
          "name",
          "toolNumber",
          "diameter",
          "cuttingHeight",
          "shoulderHeight"
        ],
        "title": "CylindricalTool",
        "type": "object"
      },
      "FeedsAndSpeeds": {
        "properties": {
          "spindleRpm": {
            "default": 12000,
            "exclusiveMinimum": 0,
            "title": "Spindle RPM",
            "type": "integer"
          },
          "plungeFeedrate": {
            "default": 250,
            "exclusiveMinimum": 0,
            "title": "Plunge feedrate",
            "type": "number",
            "x-opencam": {
              "unit": "mm/min"
            }
          },
          "leadInFeedrate": {
            "default": 500,
            "exclusiveMinimum": 0,
            "title": "Lead-in feedrate",
            "type": "number",
            "x-opencam": {
              "unit": "mm/min"
            }
          },
          "cutFeedrate": {
            "default": 500,
            "exclusiveMinimum": 0,
            "title": "Cut feedrate",
            "type": "number",
            "x-opencam": {
              "unit": "mm/min"
            }
          },
          "leadOutFeedrate": {
            "default": 500,
            "exclusiveMinimum": 0,
            "title": "Lead-out feedrate",
            "type": "number",
            "x-opencam": {
              "unit": "mm/min"
            }
          },
          "departureFeedrate": {
            "default": 500,
            "exclusiveMinimum": 0,
            "title": "Departure feedrate",
            "type": "number",
            "x-opencam": {
              "unit": "mm/min"
            }
          }
        },
        "title": "FeedsAndSpeeds",
        "type": "object"
      },
      "PartMaxZPlusOffsetClearance": {
        "properties": {
          "clearanceHeightType": {
            "const": "part_max_z_plus_offset",
            "default": "part_max_z_plus_offset",
            "title": "Clearanceheighttype",
            "type": "string"
          },
          "offset": {
            "default": 5,
            "minimum": 0,
            "title": "Offset",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "PartMaxZPlusOffsetClearance",
        "type": "object"
      },
      "Point2D": {
        "properties": {
          "x": {
            "title": "X",
            "type": "number"
          },
          "y": {
            "title": "Y",
            "type": "number"
          }
        },
        "required": [
          "x",
          "y"
        ],
        "title": "Point2D",
        "type": "object"
      },
      "Polyline25D": {
        "properties": {
          "kind": {
            "const": "polyline",
            "default": "polyline",
            "title": "Kind",
            "type": "string"
          },
          "vertices": {
            "items": {
              "$ref": "#/$defs/Point2D"
            },
            "title": "Vertices",
            "type": "array"
          },
          "z": {
            "title": "Z",
            "type": "number"
          }
        },
        "required": [
          "vertices",
          "z"
        ],
        "title": "Polyline25D",
        "type": "object"
      },
      "ProfilingCutSettings": {
        "properties": {
          "side": {
            "default": "outside",
            "enum": [
              "outside",
              "inside"
            ],
            "title": "Side",
            "type": "string"
          },
          "cutDirection": {
            "default": "climb",
            "enum": [
              "climb",
              "conventional"
            ],
            "title": "Climb/Conventional",
            "type": "string"
          },
          "stockToLeave": {
            "default": 0,
            "minimum": 0,
            "title": "Stock to leave",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "ProfilingCutSettings",
        "type": "object"
      },
      "ProfilingDriveGeometry": {
        "properties": {
          "profiles": {
            "items": {
              "anyOf": [
                {
                  "$ref": "#/$defs/ClosedPolyline25D"
                },
                {
                  "$ref": "#/$defs/Polyline25D"
                }
              ]
            },
            "minItems": 1,
            "title": "Profiles",
            "type": "array"
          }
        },
        "required": [
          "profiles"
        ],
        "title": "ProfilingDriveGeometry",
        "type": "object"
      },
      "StockMaxZPlusOffsetClearance": {
        "properties": {
          "clearanceHeightType": {
            "const": "stock_max_z_plus_offset",
            "default": "stock_max_z_plus_offset",
            "title": "Clearanceheighttype",
            "type": "string"
          },
          "offset": {
            "default": 5,
            "minimum": 0,
            "title": "Offset",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "StockMaxZPlusOffsetClearance",
        "type": "object"
      },
      "VTool": {
        "properties": {
          "id": {
            "title": "Id",
            "type": "string"
          },
          "name": {
            "title": "Name",
            "type": "string"
          },
          "toolNumber": {
            "title": "Toolnumber",
            "type": "integer"
          },
          "manualChange": {
            "default": false,
            "title": "Manualchange",
            "type": "boolean"
          },
          "diameter": {
            "title": "Diameter",
            "type": "number"
          },
          "cuttingHeight": {
            "title": "Cuttingheight",
            "type": "number"
          },
          "shoulderHeight": {
            "title": "Shoulderheight",
            "type": "number"
          },
          "numFlutes": {
            "default": 2,
            "title": "Numflutes",
            "type": "number"
          },
          "type": {
            "const": "v",
            "default": "v",
            "title": "Type",
            "type": "string"
          },
          "tipAngle": {
            "title": "Tipangle",
            "type": "number"
          }
        },
        "required": [
          "name",
          "toolNumber",
          "diameter",
          "cuttingHeight",
          "shoulderHeight",
          "tipAngle"
        ],
        "title": "VTool",
        "type": "object"
      }
    },
    "properties": {
      "type": {
        "const": "profiling_2d",
        "default": "profiling_2d",
        "title": "Type",
        "type": "string"
      },
      "id": {
        "title": "Operation ID",
        "type": "string"
      },
      "displayName": {
        "default": "2D Profile",
        "title": "Operation name",
        "type": "string"
      },
      "tool": {
        "discriminator": {
          "mapping": {
            "ball": "#/$defs/BallTool",
            "cylinder": "#/$defs/CylindricalTool",
            "v": "#/$defs/VTool"
          },
          "propertyName": "type"
        },
        "oneOf": [
          {
            "$ref": "#/$defs/CylindricalTool"
          },
          {
            "$ref": "#/$defs/BallTool"
          },
          {
            "$ref": "#/$defs/VTool"
          }
        ],
        "title": "Tool"
      },
      "feedsAndSpeeds": {
        "$ref": "#/$defs/FeedsAndSpeeds",
        "title": "Feeds and speeds"
      },
      "clearance": {
        "discriminator": {
          "mapping": {
            "absolute": "#/$defs/AbsoluteClearance",
            "part_max_z_plus_offset": "#/$defs/PartMaxZPlusOffsetClearance",
            "stock_max_z_plus_offset": "#/$defs/StockMaxZPlusOffsetClearance"
          },
          "propertyName": "clearanceHeightType"
        },
        "oneOf": [
          {
            "$ref": "#/$defs/AbsoluteClearance"
          },
          {
            "$ref": "#/$defs/StockMaxZPlusOffsetClearance"
          },
          {
            "$ref": "#/$defs/PartMaxZPlusOffsetClearance"
          }
        ],
        "title": "Clearance"
      },
      "levels": {
        "$ref": "#/$defs/CAMLevels",
        "title": "Levels"
      },
      "advanced": {
        "$ref": "#/$defs/CAMAdvancedParameters",
        "title": "Advanced"
      },
      "driveGeometry": {
        "$ref": "#/$defs/ProfilingDriveGeometry",
        "title": "Drive geometry"
      },
      "cutParameters": {
        "$ref": "#/$defs/ProfilingCutSettings",
        "title": "Cut parameters"
      }
    },
    "required": [
      "tool",
      "driveGeometry"
    ],
    "title": "Profiling2dOp",
    "type": "object"
  }
} as const;
