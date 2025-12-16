# Nocur Vision & Manifesto

> AI-powered iOS development verification. Give coding agents eyes.

## North Star

**The agent should be able to take a task like:**
> "I should be able to chat with a local LLM on my iOS app and have multiple turn chats with it that remember history"

**And then:**
1. Understand the requirement
2. Write the code
3. Build and run the app
4. USE the app like a human would (computer use - tap, type, scroll)
5. Verify the feature works by actually testing it
6. Iterate until it's done

**Completely autonomous. No hand-holding.**

---

## Core Problems to Solve

### 1. Context Delivery
The agent needs access to the RIGHT context at the RIGHT time:

| Context Type | Current State | Target State |
|--------------|---------------|--------------|
| **Screenshots** | Manual, saved to files | Auto-attached, agent can request anytime |
| **Logs** | Not available | Real-time streaming, filterable |
| **Stack Traces** | Not available | Auto-captured on crash, attached |
| **View Hierarchy** | Structured idb accessibility tree | Rich queries + stable IDs + actions |

**Two modes:**
- **Agent pull**: Agent requests what it needs
- **User push**: User manually attaches context to message

### 2. Computer Use for iOS
Agent should control the simulator like a human:
- Tap on elements by text/accessibility ID
- Type text into fields
- Scroll to find content
- Navigate between screens
- Verify visual state matches expectations

**This might mean:**
- Integrating Anthropic's computer use capability
- Or building our own vision-based interaction system
- Or hybrid: structured UI hierarchy + vision for verification

### 3. New API Problem (iOS 26+)
**Critical issue:** LLMs don't have iOS 26, Foundation Models, Apple Intelligence APIs in training data.

**Solution:**
- Agent MUST know its knowledge is outdated for latest Apple APIs
- Agent MUST pull documentation from:
  - Apple Developer Documentation (developer.apple.com)
  - Hacking with Swift (hackingwithswift.com)
  - Swift by Sundell
  - WWDC session transcripts
- WebSearch/WebFetch should be first action for any new API work

**System prompt should include:**
```
IMPORTANT: Your training data does NOT include iOS 26, Foundation Models framework,
or Apple Intelligence APIs. For ANY work involving these, you MUST first search
Apple documentation and developer resources to get accurate API information.
```

---

## Architecture Evolution

### Current (v1)
```
User → Agent → Tools (screenshot, tap, build) → Simulator
                ↑
        Manual context attachment
```

### Target (v2)
```
User → Agent → Computer Use → Simulator
         ↓           ↓
    Auto-context  Vision-based
    (logs, crash)  verification
```

### Key Changes Needed

1. **Remove/simplify live preview pane**
   - Agent sees what it needs
   - User doesn't need to babysit

2. **Add context panel**
   - Logs stream
   - Crash reports
   - Manual attachment zone (drag & drop screenshots, files)

3. **Improve view hierarchy**
   - Return accessibility identifiers
   - Return element bounds
   - Make it actually useful for targeting taps

4. **Add verification loop**
   - Agent takes action
   - Agent screenshots
   - Agent analyzes if action succeeded
   - Retry or continue

5. **Web search for new APIs**
   - Agent auto-searches Apple docs for unfamiliar APIs
   - Caches documentation context
   - Stays up-to-date with latest SDK

---

## Success Criteria

**Level 1: Basic Automation**
- [ ] Agent can build, run, screenshot without errors
- [ ] Agent can tap elements by coordinate or ID
- [ ] Agent verifies actions with screenshots

**Level 2: Intelligent Interaction**
- [ ] Agent can navigate multi-screen apps
- [ ] Agent can fill forms and submit
- [ ] Agent can detect and report errors/crashes

**Level 3: Full Autonomy**
- [ ] Agent takes high-level task → delivers working feature
- [ ] Agent tests its own work like a human would
- [ ] Agent knows when it's done (verification loop)

**Level 4: Cutting Edge**
- [ ] Agent handles iOS 26+ APIs by pulling docs
- [ ] Agent learns from failures and adapts
- [ ] Agent can debug complex issues (logs + stack traces + visual)

---

## Immediate Next Steps

1. **Add log streaming** - Real-time simulator logs in context
2. **Add crash detection** - Auto-capture stack traces
3. **Add web search for docs** - Agent pulls Apple docs when needed
4. **Verification loop** - Action → Screenshot → Analyze → Retry/Continue
5. **Multi-device support** - Smoothly switch sims + real devices

---

## Remember

- The agent should be AUTONOMOUS, not a tool that needs babysitting
- Context should flow automatically, not require manual attachment
- New APIs require documentation lookup - agent's training is outdated
- Verification is key - agent must confirm its work actually works
- Be concise, be action-oriented, fix problems don't explain them
