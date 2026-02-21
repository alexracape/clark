/**
 * Interactive tutorial walkthrough for first-time users.
 */

import React, { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { hex } from "./theme.ts";

type TutorialStep =
  | "intro"
  | "asking-questions"
  | "slash-commands"
  | "file-attachment"
  | "canvas-intro"
  | "completion";

interface TutorialProps {
  onComplete: () => void;
  onSkip: () => void;
}

const STEPS: TutorialStep[] = [
  "intro",
  "asking-questions",
  "slash-commands",
  "file-attachment",
  "canvas-intro",
  "completion",
];

export function Tutorial({ onComplete, onSkip }: TutorialProps) {
  const [step, setStep] = useState<TutorialStep>("intro");
  const { exit } = useApp();

  const currentIndex = STEPS.indexOf(step);
  const totalSteps = STEPS.length - 1; // Exclude completion from count

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    if (key.escape) {
      onSkip();
      return;
    }

    if (key.return) {
      const nextIndex = currentIndex + 1;
      if (nextIndex < STEPS.length) {
        setStep(STEPS[nextIndex]!);
      } else {
        onComplete();
      }
    }
  });

  if (step === "intro") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={hex.sky} bold>Clark Tutorial</Text>
        <Text color={hex.dimText}> </Text>
        <Text>Welcome to the Clark tutorial! Let's learn the basics in 5 quick steps.</Text>
        <Text color={hex.dimText}> </Text>
        <Text>Clark is designed to help you learn by asking guiding questions</Text>
        <Text>rather than giving direct answers. Think of it as your Socratic tutor.</Text>
        <Text color={hex.dimText}> </Text>
        <Text color={hex.dimText}>Press <Text bold color={hex.messageText}>Enter</Text> to continue, <Text bold color={hex.messageText}>Esc</Text> to skip.</Text>
      </Box>
    );
  }

  if (step === "asking-questions") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={hex.sky}>[Step 1/5] Asking Questions</Text>
        <Text color={hex.dimText}> </Text>
        <Text bold>How to ask questions:</Text>
        <Text color={hex.dimText}> </Text>
        <Text>Simply type your question in the input field and press Enter.</Text>
        <Text color={hex.dimText}> </Text>
        <Text>Example: <Text color={hex.thinkingSpinner}>"What is recursion?"</Text></Text>
        <Text color={hex.dimText}> </Text>
        <Text>Clark will respond with guiding questions to help you think through</Text>
        <Text>the concept, rather than giving you the answer directly.</Text>
        <Text color={hex.dimText}> </Text>
        <Text color={hex.brass}>Tip: The more specific your question, the better Clark can help!</Text>
        <Text color={hex.dimText}> </Text>
        <Text color={hex.dimText}>Press <Text bold color={hex.messageText}>Enter</Text> to continue, <Text bold color={hex.messageText}>Esc</Text> to skip.</Text>
      </Box>
    );
  }

  if (step === "slash-commands") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={hex.sky}>[Step 2/5] Slash Commands</Text>
        <Text color={hex.dimText}> </Text>
        <Text bold>Useful commands to know:</Text>
        <Text color={hex.dimText}> </Text>
        <Text>  <Text color={hex.brass}>/help</Text>      - See all available commands</Text>
        <Text>  <Text color={hex.brass}>/model</Text>     - Switch between LLM models</Text>
        <Text>  <Text color={hex.brass}>/canvas</Text>    - Open a drawing board (great for iPad!)</Text>
        <Text>  <Text color={hex.brass}>/export</Text>    - Save your canvas as a PDF</Text>
        <Text>  <Text color={hex.brass}>/context</Text>   - Check your current context usage</Text>
        <Text>  <Text color={hex.brass}>/clear</Text>     - Start a fresh conversation</Text>
        <Text color={hex.dimText}> </Text>
        <Text color={hex.brass}>Tip: Type <Text bold>/</Text> and press Tab to see command suggestions!</Text>
        <Text color={hex.dimText}> </Text>
        <Text color={hex.dimText}>Press <Text bold color={hex.messageText}>Enter</Text> to continue, <Text bold color={hex.messageText}>Esc</Text> to skip.</Text>
      </Box>
    );
  }

  if (step === "file-attachment") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={hex.sky}>[Step 3/5] Adding Context</Text>
        <Text color={hex.dimText}> </Text>
        <Text bold>How to share files with Clark:</Text>
        <Text color={hex.dimText}> </Text>
        <Text>You can paste file paths directly into your messages:</Text>
        <Text color={hex.dimText}> </Text>
        <Text>Example: <Text color={hex.thinkingSpinner}>"Can you explain this code? ~/homework/sort.py"</Text></Text>
        <Text color={hex.dimText}> </Text>
        <Text>Clark can read and understand:</Text>
        <Text>  • Code files (.py, .js, .java, etc.)</Text>
        <Text>  • PDFs and documents</Text>
        <Text>  • Images and screenshots</Text>
        <Text color={hex.dimText}> </Text>
        <Text color={hex.brass}>Tip: Drag and drop files into your terminal to paste their path!</Text>
        <Text color={hex.dimText}> </Text>
        <Text color={hex.dimText}>Press <Text bold color={hex.messageText}>Enter</Text> to continue, <Text bold color={hex.messageText}>Esc</Text> to skip.</Text>
      </Box>
    );
  }

  if (step === "canvas-intro") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={hex.sky}>[Step 4/5] Canvas &amp; Handwriting</Text>
        <Text color={hex.dimText}> </Text>
        <Text bold>Using the canvas with your iPad:</Text>
        <Text color={hex.dimText}> </Text>
        <Text>1. Type <Text color={hex.brass}>/canvas</Text> to start a new canvas session</Text>
        <Text>2. Open the URL on your iPad's browser</Text>
        <Text>3. Start drawing, writing, or diagramming</Text>
        <Text>4. Clark can see your canvas and respond to your work</Text>
        <Text color={hex.dimText}> </Text>
        <Text>The canvas is perfect for:</Text>
        <Text>  • Working through math problems</Text>
        <Text>  • Sketching diagrams and flowcharts</Text>
        <Text>  • Handwritten notes and brainstorming</Text>
        <Text color={hex.dimText}> </Text>
        <Text color={hex.brass}>Tip: Use <Text bold>/export</Text> to save your canvas as a PDF!</Text>
        <Text color={hex.dimText}> </Text>
        <Text color={hex.dimText}>Press <Text bold color={hex.messageText}>Enter</Text> to continue, <Text bold color={hex.messageText}>Esc</Text> to skip.</Text>
      </Box>
    );
  }

  if (step === "completion") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={hex.sky}>[Step 5/5] You're Ready!</Text>
        <Text color={hex.dimText}> </Text>
        <Text color={hex.sage} bold>Tutorial complete!</Text>
        <Text color={hex.dimText}> </Text>
        <Text>You now know how to:</Text>
        <Text color={hex.sage}>  ✓ Ask questions and get Socratic guidance</Text>
        <Text color={hex.sage}>  ✓ Use slash commands like /help and /canvas</Text>
        <Text color={hex.sage}>  ✓ Share files and code with Clark</Text>
        <Text color={hex.sage}>  ✓ Use the canvas for handwritten work</Text>
        <Text color={hex.dimText}> </Text>
        <Text>Remember: Type <Text bold color={hex.messageText}>/help</Text> anytime to see all commands.</Text>
        <Text color={hex.dimText}> </Text>
        <Text color={hex.brass}>Happy learning!</Text>
        <Text color={hex.dimText}> </Text>
        <Text color={hex.dimText}>Press <Text bold color={hex.messageText}>Enter</Text> to finish.</Text>
      </Box>
    );
  }

  return null;
}
