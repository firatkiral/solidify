[1.0.6]

- [x] feat: Enhance gizmo rendering and measurement features
- [x] feat: Implement Ctrl key functionality to bypass snapping and add related tests
- [x] feat: Update Keybindings component layout for improved responsiveness and styling
- [x] feat: Add HeightAxisSnap and implement height restriction in PointPicker for improved snapping functionality
- [x] feat: Enhance backup functionality with thumbnail support and improve SnapManager comments
- [x] refactor: update gizmo materials and geometries for consistency
- [x] refactor: update comments and improve material color handling across components
- [x] feat: Implement placeClear function for label positioning and add tests for its functionality
- [x] feat: Implement touchpad detection for initial orbit mode selection and add related tests
- [x] feat: implement gizmo interaction improvements and occlusion handling
- [x] feat: replace toolbar with mini bar for enhanced command access
- [x] feat: update default theme to dark mode and adjust related styles for improved UI consistency

[1.0.5]

- [x] feat: Enhance boolean operations and extrude functionality
- [x] feat: Refactor geometry meshing to support angle precision and threaded kernel loading
- [x] feat: Implement offset curve functionality with gap fill options
- [x] feat: Add tests for FilletFaceFactory to validate fillet and chamfer face detection
- [x] feat: Update measurements to use radius instead of diameter and add tests for radius functionality
- [x] feat: Rename 'lock distances' to 'symmetric' and update related tests for clarity
- [x] feat: Enhance PointPicker to support Shift key for guide line addition and snap locking

[1.0.4]

- [x] Remove SelectionProxy class and its methods
- [x] feat: implement unit system for length measurements and snapping
- [x] feat: prevent page scrolling and navigation during trackpad gestures
- [x] Refactor snapping functionality to remove reliance on key modifiers
- [x] feat: enhance autosave functionality to include untitled documents and clarify settings
- [x] feat: Implement drawer component with selection and properties panels
- [x] feat: add overflow clipping to workspace to prevent page scrolling

[1.0.3]

- [x] Refactor SelectionProxy methods to use Selectable type for add and remove

[1.0.2]

- [x] Stop autosaving on selection, and save solids without display meshes

[1.0.1]

- [x] The frame rate and timing stats show only in development

[1.0.0]

- [x] Renamed to Solidify; documents are saved as .solidify files and settings live in ~/.solidify
- [x] Geometry kernel replaced with OpenCascade (OCCT)
- [x] Spiral tool, with sweeps along spirals for threads
- [x] Tangent snaps from a point to a curve and between two curves
- [x] Exact areas for regions bounded by arcs and splines
- [x] Undo no longer leaves stale curve fragments after a curve cuts another
- [x] Screw tutorial in tutorials/screw

[0.1.9]

- [x] Can't remove fillet using modify contour command #bug  
- [x] Test trim - and anywhere objectpicker is used  
- [x] scale freestyle broken on commit #bug  
- [x] Can't modify endpoint of specific curve #bug  
- [x] Need to be able to drag and drop point when point selected & fillet I suppose  
- [x] move point twice without moving the mouse inbetween and it doesn't work #bug  
- [x] click on control point to select  
- [x] Make control points themselves d&d able (no circle)  
- [x] Normalize curve should convert planar curves to space curves  
- [x] Scale to flatten freestyle  
- [x] Point picker restrict to line not working great with scale freestyle command (xyz axes seem available) #bug  
- [x] Deleting points in a contour should work  
- [x] Freestyle move control point  
- [x] Freestyle scale control point  
- [x] Remove consolidate freestyle/basic factories and let the commands use direct guys  
- [x] Make control points work with rotate  
- [x] Consolidate rotate command  
- [x] Scale control points  
- [x] Selecting control point should unselect curve #bug  
- [x] Make control points work with move  
- [x] Freestyle rotate control point  
- [x] once you do a freestyle scale, left clicking doesn't exit for some reason #bug  
- [x] Scale to flatten basic curve  

