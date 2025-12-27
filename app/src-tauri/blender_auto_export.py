"""
BuildHuman Blender Auto-Export Handler

This script is injected into Blender when editing assets.
It automatically exports the scene to GLB format on save (Ctrl+S).
"""

import bpy
from bpy.app.handlers import persistent

# Export path will be injected by BuildHuman
EXPORT_PATH = "{export_path}"

@persistent
def auto_export_glb(dummy):
    """
    Automatically export the current Blender scene to GLB when saved.
    This handler is triggered after the .blend file is saved.
    """
    try:
        print(f"BuildHuman: Auto-exporting GLB to {EXPORT_PATH}")

        bpy.ops.export_scene.gltf(
            filepath=EXPORT_PATH,
            export_format='GLB',
            export_keep_originals=False,
            export_texcoords=True,
            export_normals=True,
            export_materials='EXPORT',
            export_colors=True,
            export_cameras=False,
            export_lights=False,
            export_apply=True  # Apply modifiers
        )

        print("BuildHuman: GLB export complete!")

    except Exception as e:
        print(f"BuildHuman: Export failed: {e}")

# Register the handler
if auto_export_glb not in bpy.app.handlers.save_post:
    bpy.app.handlers.save_post.append(auto_export_glb)
    print(f"BuildHuman: Auto-export enabled for {EXPORT_PATH}")

# Show a message to the user
def show_export_message():
    """Show a popup message to inform the user about auto-export"""
    def draw(self, context):
        self.layout.label(text="BuildHuman auto-export enabled!")
        self.layout.label(text=f"Save exports to: {EXPORT_PATH}")

    bpy.context.window_manager.popup_menu(draw, title="BuildHuman", icon='INFO')

# Show the message after a short delay (so Blender UI is ready)
bpy.app.timers.register(show_export_message, first_interval=1.0)

print("=" * 60)
print("BuildHuman Auto-Export Active")
print(f"Export Path: {EXPORT_PATH}")
print("Press Ctrl+S to save and auto-export GLB")
print("=" * 60)
