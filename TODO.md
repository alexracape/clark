Some future enhancements and things that need fixing.

## Canvas
- Styling
- Allow users to toggle between PDF and Canvas mode.
  - Export as PDF would not be allowd for Canvas
- Allow users to switch which canvas is active maybe with /canvas or even from iPad
- Debug new page creation on single canvas

## LLMs

## MCP

## TUI
- A little jumpiness in the UI when toggling some / menus
- / then delete fails to register the delete
- /invalid_command should throw an error instead of sending it to the LLM
- /notes should be switched to /library and it should allow you to switch that path if you want
- /resource needs to accept file upload with file explorer, drag-and-drop, or something
- Need to refine the /structures commands
  - The model's responses are too verbose and need prompting work
  - Should look into ways to collect args like a conversational process in moveworks


## Misc.
- Lightweight markdown editor potentially with tiptap
- Office hours and class notes stories
- Look into tldraw licensing
- Build site to publish the binary with documentation
- Onboarding should add folders like Structures if not in preexisting folder
- Security audit for API keys, prompt injection, or any other vulnerabilities
