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
      "CAMAdvancedParameters": {
        "properties": {
          "operationsSorting": {
            "default": "selection",
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
            "default": "at_top",
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
      "CamSetupConfig": {
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
        "title": "CamSetupConfig",
        "type": "object",
        "x-opencam": {
          "hidden": true
        }
      },
      "ClosedCurveSelection": {
        "properties": {
          "planeZ": {
            "title": "Drive geometry plane Z",
            "type": "number",
            "x-opencam": {
              "hidden": true,
              "readOnly": true,
              "unit": "mm"
            }
          },
          "vertices": {
            "description": "Closed curves or closed surface edges captured from the selected mesh face.",
            "items": {
              "$ref": "#/$defs/Point2D"
            },
            "minItems": 3,
            "title": "Closed curve vertices",
            "type": "array",
            "x-opencam": {
              "hidden": true,
              "readOnly": true
            }
          }
        },
        "required": [
          "planeZ",
          "vertices"
        ],
        "title": "ClosedCurveSelection",
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
      "ManualFeedsAndSpeedsSelection": {
        "properties": {
          "mode": {
            "const": "manual",
            "default": "manual",
            "title": "Mode",
            "type": "string"
          },
          "feedsAndSpeeds": {
            "$ref": "#/$defs/FeedsAndSpeeds"
          }
        },
        "title": "ManualFeedsAndSpeedsSelection",
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
      "Pocket2DOperationConfig": {
        "properties": {
          "id": {
            "title": "Operation ID",
            "type": "string",
            "x-opencam": {
              "hidden": true
            }
          },
          "displayName": {
            "default": "2D Pocket",
            "title": "Operation name",
            "type": "string",
            "x-opencam": {
              "hidden": true
            }
          },
          "toolId": {
            "minLength": 1,
            "title": "Tool",
            "type": "string",
            "x-opencam": {
              "widget": "tool-select"
            }
          },
          "feedsAndSpeeds": {
            "discriminator": {
              "mapping": {
                "manual": "#/$defs/ManualFeedsAndSpeedsSelection",
                "tool_material": "#/$defs/ToolMaterialFeedsAndSpeedsSelection"
              },
              "propertyName": "mode"
            },
            "oneOf": [
              {
                "$ref": "#/$defs/ManualFeedsAndSpeedsSelection"
              },
              {
                "$ref": "#/$defs/ToolMaterialFeedsAndSpeedsSelection"
              }
            ],
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
          "kind": {
            "const": "pocket2d",
            "default": "pocket2d",
            "title": "Operation kind",
            "type": "string",
            "x-opencam": {
              "hidden": true
            }
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
          "toolId",
          "driveGeometry"
        ],
        "title": "Pocket2DOperationConfig",
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
              "$ref": "#/$defs/ClosedCurveSelection"
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
        "type": "object",
        "x-opencam": {
          "hidden": true
        }
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
        "type": "object",
        "x-opencam": {
          "hidden": true
        }
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
        "type": "object",
        "x-opencam": {
          "hidden": true
        }
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
      "ToolMaterialFeedsAndSpeedsSelection": {
        "properties": {
          "mode": {
            "const": "tool_material",
            "default": "tool_material",
            "title": "Mode",
            "type": "string"
          },
          "materialId": {
            "minLength": 1,
            "title": "Materialid",
            "type": "string"
          },
          "toolMaterialFeedsAndSpeedsId": {
            "minLength": 1,
            "title": "Toolmaterialfeedsandspeedsid",
            "type": "string"
          }
        },
        "required": [
          "materialId",
          "toolMaterialFeedsAndSpeedsId"
        ],
        "title": "ToolMaterialFeedsAndSpeedsSelection",
        "type": "object"
      }
    },
    "properties": {
      "setup": {
        "$ref": "#/$defs/CamSetupConfig",
        "title": "Setup"
      },
      "operation": {
        "discriminator": {
          "mapping": {
            "pocket2d": "#/$defs/Pocket2DOperationConfig"
          },
          "propertyName": "kind"
        },
        "oneOf": [
          {
            "$ref": "#/$defs/Pocket2DOperationConfig"
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
      "CAMAdvancedParameters": {
        "properties": {
          "operationsSorting": {
            "default": "selection",
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
            "default": "at_top",
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
      "ClosedCurveSelection": {
        "properties": {
          "planeZ": {
            "title": "Drive geometry plane Z",
            "type": "number",
            "x-opencam": {
              "hidden": true,
              "readOnly": true,
              "unit": "mm"
            }
          },
          "vertices": {
            "description": "Closed curves or closed surface edges captured from the selected mesh face.",
            "items": {
              "$ref": "#/$defs/Point2D"
            },
            "minItems": 3,
            "title": "Closed curve vertices",
            "type": "array",
            "x-opencam": {
              "hidden": true,
              "readOnly": true
            }
          }
        },
        "required": [
          "planeZ",
          "vertices"
        ],
        "title": "ClosedCurveSelection",
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
      "ManualFeedsAndSpeedsSelection": {
        "properties": {
          "mode": {
            "const": "manual",
            "default": "manual",
            "title": "Mode",
            "type": "string"
          },
          "feedsAndSpeeds": {
            "$ref": "#/$defs/FeedsAndSpeeds"
          }
        },
        "title": "ManualFeedsAndSpeedsSelection",
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
              "$ref": "#/$defs/ClosedCurveSelection"
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
      "ToolMaterialFeedsAndSpeedsSelection": {
        "properties": {
          "mode": {
            "const": "tool_material",
            "default": "tool_material",
            "title": "Mode",
            "type": "string"
          },
          "materialId": {
            "minLength": 1,
            "title": "Materialid",
            "type": "string"
          },
          "toolMaterialFeedsAndSpeedsId": {
            "minLength": 1,
            "title": "Toolmaterialfeedsandspeedsid",
            "type": "string"
          }
        },
        "required": [
          "materialId",
          "toolMaterialFeedsAndSpeedsId"
        ],
        "title": "ToolMaterialFeedsAndSpeedsSelection",
        "type": "object"
      }
    },
    "properties": {
      "id": {
        "title": "Operation ID",
        "type": "string",
        "x-opencam": {
          "hidden": true
        }
      },
      "displayName": {
        "default": "2D Pocket",
        "title": "Operation name",
        "type": "string",
        "x-opencam": {
          "hidden": true
        }
      },
      "toolId": {
        "minLength": 1,
        "title": "Tool",
        "type": "string",
        "x-opencam": {
          "widget": "tool-select"
        }
      },
      "feedsAndSpeeds": {
        "discriminator": {
          "mapping": {
            "manual": "#/$defs/ManualFeedsAndSpeedsSelection",
            "tool_material": "#/$defs/ToolMaterialFeedsAndSpeedsSelection"
          },
          "propertyName": "mode"
        },
        "oneOf": [
          {
            "$ref": "#/$defs/ManualFeedsAndSpeedsSelection"
          },
          {
            "$ref": "#/$defs/ToolMaterialFeedsAndSpeedsSelection"
          }
        ],
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
      "kind": {
        "const": "pocket2d",
        "default": "pocket2d",
        "title": "Operation kind",
        "type": "string",
        "x-opencam": {
          "hidden": true
        }
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
      "toolId",
      "driveGeometry"
    ],
    "title": "Pocket2DOperationConfig",
    "type": "object"
  }
} as const;
