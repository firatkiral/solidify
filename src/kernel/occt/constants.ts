// Numeric values of the kernel enums (lib/c3d/enums.ts) used inside the OCCT kernel.
// They are duplicated here because lib/c3d/enums.ts depends on the kernel module itself.

export const SpaceType = {
    SpaceItem: 1,
    Point3D: 101,
    Curve3D: 201,
    Line3D: 202,
    LineSegment3D: 203,
    Arc3D: 204,
    Spiral: 205,
    ConeSpiral: 206,
    PolyCurve3D: 209,
    Polyline3D: 210,
    Nurbs3D: 211,
    Bezier3D: 212,
    Hermit3D: 213,
    CubicSpline3D: 214,
    PlaneCurve: 215,
    TrimmedCurve3D: 217,
    CharacterCurve3D: 220,
    ContourOnSurface: 221,
    ContourOnPlane: 222,
    Contour3D: 227,
    Surface: 301,
    ElementarySurface: 302,
    Plane: 303,
    ConeSurface: 304,
    CylinderSurface: 305,
    SphereSurface: 306,
    TorusSurface: 307,
    ExtrusionSurface: 309,
    RevolutionSurface: 310,
    SplineSurface: 319,
    OffsetSurface: 323,
    Item: 501,
    Solid: 505,
    Instance: 506,
    Assembly: 507,
    Mesh: 508,
    SpaceInstance: 509,
    PlaneInstance: 510,
} as const;

export const PlaneType = {
    PlaneItem: 1,
    Curve: 201,
    Line: 202,
    LineSegment: 203,
    Arc: 204,
    PolyCurve: 206,
    Polyline: 207,
    Bezier: 208,
    Hermit: 209,
    Nurbs: 210,
    CubicSpline: 211,
    TrimmedCurve: 212,
    Contour: 301,
    Region: 501,
} as const;

export const TopologyType = {
    TopItem: 1,
    Vertex: 101,
    Edge: 201,
    CurveEdge: 202,
    OrientedEdge: 203,
    Loop: 301,
    Face: 401,
    FaceShell: 501,
} as const;

export const RefType = {
    RefItem: 0,
    PlaneItem: 1,
    SpaceItem: 2,
    TopItem: 3,
    Creator: 4,
    Attribute: 5,
    Primitive: 6,
} as const;

export const ItemLocation = {
    Undefined: -3,
    Unknown: -2,
    OutOfItem: -1,
    OnItem: 0,
    InItem: 1,
    ByItem: 2,
} as const;

export const OperationType = {
    Internal: -4,
    External: -3,
    Intersect: -2,
    Difference: -1,
    Unknown: 0,
    Union: 1,
    Base: 2,
    Variety: 3,
} as const;

export const PRECISION = 1e-7;
export const METRIC_EPSILON = 1e-6;

export const ElementaryShellType = {
    Sphere: 0,
    Torus: 1,
    Cylinder: 2,
    Cone: 3,
    Block: 4,
} as const;

export const ModifyingType = {
    Remove: 0,
    Create: 1,
    Action: 2,
    Offset: 3,
    Fillet: 4,
    Supple: 5,
    Purify: 6,
    Merger: 7,
    United: 8,
} as const;

export const OffsetGapFill = {
    Round: 0,
    Linear: 1,
    Natural: 2,
} as const;

export const ConvResType = {
    Success: 0,
    Error: 1,
    NoObjects: 4,
    FileOpenError: 5,
    FileWriteError: 6,
    UnknownExtension: 11,
} as const;
