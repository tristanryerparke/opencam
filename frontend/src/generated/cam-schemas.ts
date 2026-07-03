/**
 * This file is auto-generated from Python Pydantic models.
 * Do not edit it by hand.
 */
export const camSchemaBundle = {
  "generateToolpathRequest": {
    "$defs": {
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
          "hidden": true,
          "tabId": "setup",
          "tabTitle": "All Setups"
        }
      },
      "ClosedCurveSelection": {
        "properties": {
          "source": {
            "const": "selectedFaceBoundary",
            "default": "selectedFaceBoundary",
            "title": "Geometry source",
            "type": "string"
          },
          "planeZ": {
            "title": "Drive geometry plane Z",
            "type": "number",
            "x-opencam": {
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
              "readOnly": true
            }
          },
          "selectionLabel": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ],
            "default": null,
            "title": "Selection label",
            "x-opencam": {
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
      "Pocket2DOperationConfig": {
        "properties": {
          "id": {
            "title": "Operation ID",
            "type": "string",
            "x-opencam": {
              "hidden": true
            }
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
          "displayName": {
            "default": "2D Pocket",
            "title": "Operation name",
            "type": "string",
            "x-opencam": {
              "hidden": true
            }
          },
          "controlGeometry": {
            "$ref": "#/$defs/PocketControlGeometrySection",
            "title": "Control geometry"
          },
          "cutParameters": {
            "$ref": "#/$defs/PocketCutParametersSection",
            "title": "Cut parameters"
          },
          "material": {
            "$ref": "#/$defs/PocketMaterialSection",
            "title": "Material"
          },
          "tool": {
            "$ref": "#/$defs/PocketToolSection",
            "title": "Tool"
          },
          "levels": {
            "$ref": "#/$defs/PocketLevelsSection",
            "title": "Levels"
          },
          "clearance": {
            "$ref": "#/$defs/PocketClearanceSection",
            "title": "Clearence"
          },
          "advanced": {
            "$ref": "#/$defs/PocketAdvancedSection",
            "title": "Advanced"
          }
        },
        "title": "Pocket2DOperationConfig",
        "type": "object"
      },
      "PocketAdvancedSection": {
        "properties": {
          "operationSorting": {
            "const": "shortestTravel",
            "default": "shortestTravel",
            "title": "Operation sorting",
            "type": "string"
          },
          "cutTransitions": {
            "const": "clearance",
            "default": "clearance",
            "title": "Cut transitions",
            "type": "string"
          },
          "layerOrder": {
            "default": "perLayer",
            "enum": [
              "perArea",
              "perLayer"
            ],
            "title": "Layer order",
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
        "title": "PocketAdvancedSection",
        "type": "object",
        "x-opencam": {
          "tabId": "advanced",
          "tabTitle": "Advanced"
        }
      },
      "PocketClearanceSection": {
        "properties": {
          "clearancePlaneHeight": {
            "default": 25.4,
            "description": "Absolute clearance plane height used for retracts and transfers when selected.",
            "title": "Clearance plane height",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          },
          "transferHeightMode": {
            "default": "clearancePlane",
            "description": "Use the clearance plane directly, or compute transfer height as stock max Z plus an offset.",
            "enum": [
              "clearancePlane",
              "stockTopPlusOffset"
            ],
            "title": "Transfer height",
            "type": "string"
          },
          "transferHeightOffset": {
            "default": 5,
            "description": "Only used when transfer height comes from stock max Z + X.",
            "minimum": 0,
            "title": "Transfer height offset",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "PocketClearanceSection",
        "type": "object",
        "x-opencam": {
          "tabId": "clearance",
          "tabTitle": "Clearence"
        }
      },
      "PocketControlGeometrySection": {
        "properties": {
          "driveGeometry": {
            "$ref": "#/$defs/ClosedCurveSelection",
            "title": "Drive geometries"
          }
        },
        "required": [
          "driveGeometry"
        ],
        "title": "PocketControlGeometrySection",
        "type": "object",
        "x-opencam": {
          "tabId": "controlGeometry",
          "tabTitle": "Control geometry"
        }
      },
      "PocketCutParametersSection": {
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
            "default": 25,
            "exclusiveMinimum": 0,
            "maximum": 100,
            "title": "Stepover",
            "type": "number",
            "x-opencam": {
              "unit": "%"
            }
          },
          "stockToLeave": {
            "default": 0,
            "minimum": 0,
            "title": "Stock to leave",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          },
          "pocketStrategy": {
            "default": "inside",
            "enum": [
              "inside",
              "outside"
            ],
            "title": "Pocket from inside/outside",
            "type": "string"
          }
        },
        "title": "PocketCutParametersSection",
        "type": "object",
        "x-opencam": {
          "tabId": "cutParameters",
          "tabTitle": "Cut parameters"
        }
      },
      "PocketLevelsSection": {
        "properties": {
          "driveGeometryReference": {
            "default": "top",
            "enum": [
              "top",
              "bottom"
            ],
            "title": "Drive geometry at top/bottom",
            "type": "string"
          },
          "topZ": {
            "default": 0,
            "title": "Height of cut (top Z)",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          },
          "bottomZ": {
            "default": -5,
            "title": "Bottom Z",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          },
          "maxCutDepth": {
            "default": 20,
            "description": "Maximum layer depth per pass.",
            "exclusiveMinimum": 0,
            "title": "Max cut depth",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "PocketLevelsSection",
        "type": "object",
        "x-opencam": {
          "tabId": "levels",
          "tabTitle": "Levels"
        }
      },
      "PocketMaterialSection": {
        "properties": {
          "feedrate": {
            "default": 500,
            "exclusiveMinimum": 0,
            "title": "Feedrate",
            "type": "number",
            "x-opencam": {
              "unit": "mm/min"
            }
          },
          "rpm": {
            "default": 12000,
            "exclusiveMinimum": 0,
            "title": "RPM",
            "type": "integer"
          }
        },
        "title": "PocketMaterialSection",
        "type": "object",
        "x-opencam": {
          "tabId": "material",
          "tabTitle": "Material"
        }
      },
      "PocketToolSection": {
        "properties": {
          "diameter": {
            "default": 12,
            "exclusiveMinimum": 0,
            "title": "Diameter",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          },
          "fluteLength": {
            "default": 30,
            "exclusiveMinimum": 0,
            "title": "Flute length",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          },
          "toolNumber": {
            "default": 1,
            "minimum": 1,
            "title": "Tool #",
            "type": "integer"
          },
          "manualChange": {
            "default": false,
            "title": "Manual change",
            "type": "boolean"
          }
        },
        "title": "PocketToolSection",
        "type": "object",
        "x-opencam": {
          "tabId": "tool",
          "tabTitle": "Tool"
        }
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
          "hidden": true,
          "tabId": "orientation",
          "tabTitle": "Orientation"
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
          "hidden": true,
          "tabId": "origin",
          "tabTitle": "Origin"
        }
      },
      "SetupStock": {
        "properties": {
          "maxZ": {
            "default": 0,
            "description": "Used when transfer height is computed from stock height.",
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
          "hidden": true,
          "tabId": "stock",
          "tabTitle": "Stock"
        }
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
      "ClosedCurveSelection": {
        "properties": {
          "source": {
            "const": "selectedFaceBoundary",
            "default": "selectedFaceBoundary",
            "title": "Geometry source",
            "type": "string"
          },
          "planeZ": {
            "title": "Drive geometry plane Z",
            "type": "number",
            "x-opencam": {
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
              "readOnly": true
            }
          },
          "selectionLabel": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ],
            "default": null,
            "title": "Selection label",
            "x-opencam": {
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
      "PocketAdvancedSection": {
        "properties": {
          "operationSorting": {
            "const": "shortestTravel",
            "default": "shortestTravel",
            "title": "Operation sorting",
            "type": "string"
          },
          "cutTransitions": {
            "const": "clearance",
            "default": "clearance",
            "title": "Cut transitions",
            "type": "string"
          },
          "layerOrder": {
            "default": "perLayer",
            "enum": [
              "perArea",
              "perLayer"
            ],
            "title": "Layer order",
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
        "title": "PocketAdvancedSection",
        "type": "object",
        "x-opencam": {
          "tabId": "advanced",
          "tabTitle": "Advanced"
        }
      },
      "PocketClearanceSection": {
        "properties": {
          "clearancePlaneHeight": {
            "default": 25.4,
            "description": "Absolute clearance plane height used for retracts and transfers when selected.",
            "title": "Clearance plane height",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          },
          "transferHeightMode": {
            "default": "clearancePlane",
            "description": "Use the clearance plane directly, or compute transfer height as stock max Z plus an offset.",
            "enum": [
              "clearancePlane",
              "stockTopPlusOffset"
            ],
            "title": "Transfer height",
            "type": "string"
          },
          "transferHeightOffset": {
            "default": 5,
            "description": "Only used when transfer height comes from stock max Z + X.",
            "minimum": 0,
            "title": "Transfer height offset",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "PocketClearanceSection",
        "type": "object",
        "x-opencam": {
          "tabId": "clearance",
          "tabTitle": "Clearence"
        }
      },
      "PocketControlGeometrySection": {
        "properties": {
          "driveGeometry": {
            "$ref": "#/$defs/ClosedCurveSelection",
            "title": "Drive geometries"
          }
        },
        "required": [
          "driveGeometry"
        ],
        "title": "PocketControlGeometrySection",
        "type": "object",
        "x-opencam": {
          "tabId": "controlGeometry",
          "tabTitle": "Control geometry"
        }
      },
      "PocketCutParametersSection": {
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
            "default": 25,
            "exclusiveMinimum": 0,
            "maximum": 100,
            "title": "Stepover",
            "type": "number",
            "x-opencam": {
              "unit": "%"
            }
          },
          "stockToLeave": {
            "default": 0,
            "minimum": 0,
            "title": "Stock to leave",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          },
          "pocketStrategy": {
            "default": "inside",
            "enum": [
              "inside",
              "outside"
            ],
            "title": "Pocket from inside/outside",
            "type": "string"
          }
        },
        "title": "PocketCutParametersSection",
        "type": "object",
        "x-opencam": {
          "tabId": "cutParameters",
          "tabTitle": "Cut parameters"
        }
      },
      "PocketLevelsSection": {
        "properties": {
          "driveGeometryReference": {
            "default": "top",
            "enum": [
              "top",
              "bottom"
            ],
            "title": "Drive geometry at top/bottom",
            "type": "string"
          },
          "topZ": {
            "default": 0,
            "title": "Height of cut (top Z)",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          },
          "bottomZ": {
            "default": -5,
            "title": "Bottom Z",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          },
          "maxCutDepth": {
            "default": 20,
            "description": "Maximum layer depth per pass.",
            "exclusiveMinimum": 0,
            "title": "Max cut depth",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          }
        },
        "title": "PocketLevelsSection",
        "type": "object",
        "x-opencam": {
          "tabId": "levels",
          "tabTitle": "Levels"
        }
      },
      "PocketMaterialSection": {
        "properties": {
          "feedrate": {
            "default": 500,
            "exclusiveMinimum": 0,
            "title": "Feedrate",
            "type": "number",
            "x-opencam": {
              "unit": "mm/min"
            }
          },
          "rpm": {
            "default": 12000,
            "exclusiveMinimum": 0,
            "title": "RPM",
            "type": "integer"
          }
        },
        "title": "PocketMaterialSection",
        "type": "object",
        "x-opencam": {
          "tabId": "material",
          "tabTitle": "Material"
        }
      },
      "PocketToolSection": {
        "properties": {
          "diameter": {
            "default": 12,
            "exclusiveMinimum": 0,
            "title": "Diameter",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          },
          "fluteLength": {
            "default": 30,
            "exclusiveMinimum": 0,
            "title": "Flute length",
            "type": "number",
            "x-opencam": {
              "unit": "mm"
            }
          },
          "toolNumber": {
            "default": 1,
            "minimum": 1,
            "title": "Tool #",
            "type": "integer"
          },
          "manualChange": {
            "default": false,
            "title": "Manual change",
            "type": "boolean"
          }
        },
        "title": "PocketToolSection",
        "type": "object",
        "x-opencam": {
          "tabId": "tool",
          "tabTitle": "Tool"
        }
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
      "kind": {
        "const": "pocket2d",
        "default": "pocket2d",
        "title": "Operation kind",
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
      "controlGeometry": {
        "$ref": "#/$defs/PocketControlGeometrySection",
        "title": "Control geometry"
      },
      "cutParameters": {
        "$ref": "#/$defs/PocketCutParametersSection",
        "title": "Cut parameters"
      },
      "material": {
        "$ref": "#/$defs/PocketMaterialSection",
        "title": "Material"
      },
      "tool": {
        "$ref": "#/$defs/PocketToolSection",
        "title": "Tool"
      },
      "levels": {
        "$ref": "#/$defs/PocketLevelsSection",
        "title": "Levels"
      },
      "clearance": {
        "$ref": "#/$defs/PocketClearanceSection",
        "title": "Clearence"
      },
      "advanced": {
        "$ref": "#/$defs/PocketAdvancedSection",
        "title": "Advanced"
      }
    },
    "title": "Pocket2DOperationConfig",
    "type": "object"
  }
} as const;
