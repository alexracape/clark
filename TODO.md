Some future enhancements and things that need fixing.

## Canvas
- Styling
- Save button or only use CLI for this?
- Multiple pages in the same canvas
- Make it impossible for users to delete the A4 page element
- Allow users to toggle between PDF and Canvas mode.
- Save and load canvases

## LLMs
- Get Ollama seamlessly working
  - Right now, there is an issue when ollama is the default model on startup
  - It looks like somewhere llama 3.2 is still being passed
  - ollama list also lists available models and not necessarily running models
  - Is there a way to start running the model if it is not going right now?

## MCP

## TUI
- Add /class, /idea, /resource, /paper, /problem_set
  - Each of these should help configure a set of files in the user's vault / notes folder
  - I think that this logic should sit a level above the MCP server since that offers atomic filesystem actions
  - Maybe these can exist as skills in markdown?
  - I put examples of the workflows in test/test_vault/Structures
  - My hesitation is that a lot of them are pretty deterministic, but some flexibility could be nice especially if users want to customize this behavior

## Misc.
- Lightweight markdown editor potentially with tiptap
- Office hours and class notes stories
- Look into tldraw licensing
- Build site to publish the binary with documentation
- Onboarding and creation of starting folders if not specified
