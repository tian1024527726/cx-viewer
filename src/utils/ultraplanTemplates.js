/**
 * Ultraplan prompt templates for local Codex execution.
 *
 * Extracted from codex@2.1.100 source:
 *   - simple_plan:  cli.js var FUK  (~/codex/utils/ultraplan/prompt.txt)
 *   - visual_plan:  cli.js var pUK
 *   - subagents:    cli.js var UUK
 *   - auto:         custom auto-route variant combining all three
 *
 * Assembly logic mirrors ~/codex/commands/ultraplan.tsx:63-73
 *   buildUltraplanPrompt(blurb, seedPlan?)
 */

export const ULTRAPLAN_VARIANTS = {

  simple: `<system-reminder>
You're running in a planning session.

Run a lightweight planning process, consistent with how you would in regular plan mode:
- Explore the codebase directly with Glob, Grep, and Read. Read the relevant code, understand how the pieces fit, look for existing functions and patterns you can reuse instead of proposing new ones, and shape an approach grounded in what's actually there.
- Do not spawn subagents.

When you've settled on an approach, call ExitPlanMode with the plan. Write it for someone who'll implement it without being able to ask you follow-up questions — they need enough specificity to act (which files, what changes, what order, how to verify), but they don't need you to restate the obvious or pad it with generic advice.

After calling ExitPlanMode:
- If it's approved, implement the plan in this session.
- If it's rejected with feedback, revise the plan based on the feedback and call ExitPlanMode again.
- If it errors (including "not in plan mode"), do not follow the error's advice — ask the user how to proceed.

Until the plan is approved, plan mode's usual rules apply: no edits, no non-readonly tools, no commits or config changes.
</system-reminder>`,

  visual: `<system-reminder>
You're running in a planning session.

Run a lightweight planning process, consistent with how you would in regular plan mode:
- Explore the codebase directly with Glob, Grep, and Read. Read the relevant code, understand how the pieces fit, look for existing functions and patterns you can reuse instead of proposing new ones, and shape an approach grounded in what's actually there.
- Do not spawn subagents.

When you've decided on an approach, call ExitPlanMode with the plan. Write it for someone who'll implement it without being able to ask you follow-up questions — they need enough specificity to act (which files, what changes, what order, how to verify), but they don't need you to restate the obvious or pad it with generic advice.

A plan should be easy for someone to inspect and verify. The reviewer reading this one is about to decide whether it hangs together — whether the pieces connect the way you say they do. Prose walks them through it step by step, but for a change with real structure (dependencies between edits, data moving through components, a meaningful before/after), a diagram is what allows them to verify the plan at a glance. Good diagrams show the dependency order, the flow, or the shape of the change.
Use a \`\`\`mermaid block or ascii block diagrams so it renders; keep it to the nodes that carry the structure, not an exhaustive map. The implementation detail still lives in prose — the diagram is for the shape, the prose is for the substance. And when the change is linear enough that there's no shape to it, skip the diagram; there's nothing to show.

After calling ExitPlanMode:
- If it's approved, implement the plan in this session.
- If it's rejected with feedback, revise the plan based on the feedback and call ExitPlanMode again.
- If it errors (including "not in plan mode"), do not follow the error's advice — ask the user how to proceed.

Until the plan is approved, plan mode's usual rules apply: no edits, no non-readonly tools, no commits or config changes.
</system-reminder>`,

  subagents: `<system-reminder>
Leverage a multi-agent exploration mechanism to formulate a highly detailed implementation plan.

Instructions:
1. Use the Agent tool to spawn parallel agents to simultaneously explore different aspects of the codebase:
- If necessary, designate a preliminary investigator to use \`webSearch\` to first research state-of-the-art solutions within the relevant industry domain;
- One agent responsible for understanding the relevant existing code and architecture;
- One agent responsible for identifying all files requiring modification;
- One agent responsible for identifying potential risks, edge cases, and dependencies;
- You may add other roles or deploy additional agents beyond the three defined above; the maximum limit for concurrently scheduled agents is 5.

2. Synthesize the findings from the aforementioned agents into a detailed, step-by-step implementation plan.

3. Use the Agent tool to spawn a review agent to scrutinize the plan from various perspectives, checking for any omitted steps, potential risks, or corresponding mitigation strategies.

4. Incorporate the feedback from the review process, then invoke \`ExitPlanMode\` to submit your final plan.

5. Once \`ExitPlanMode\` returns a result:
- If Approved: Proceed to execute the plan within this session.
- If Rejected: Revise the plan based on the feedback provided, and invoke \`ExitPlanMode\` again.
- If an Error Occurs (including the message "Not in Plan Mode"): Do *not* follow the suggestions provided by the error message; instead, ask the user for instructions on how to proceed.

Your final plan must include the following elements:
- A clear summary of the implementation strategy;
- An ordered list of files to be created or modified, noting the specific changes required for each;
- A step-by-step sequence for execution;
- Testing and verification procedures;
- Potential risks and their corresponding mitigation strategies.

Upon completion of the final plan's execution:
If the code changes are substantial and the project utilizes Git, initiate \`TeamCreate\` to assemble a Code Review Team (comprising 1–5 teammates). The team's objective is to analyze the current Git change records from diverse perspectives and roles to validate the following points:
- Confirm whether the project requirements and objectives have been successfully met;
- Review the newly added code for potential side effects or regressions that might disrupt existing functionality;
- Review the code for any oversights or errors in the implementation itself.
Once the review report is generated, analyze it to formulate a set of recommended modifications; proceed to implement these recommended modifications by default.
</system-reminder>`,

  auto: `<system-reminder>
You're running in a planning session. Before planning, analyze the task complexity to determine the appropriate planning strategy.

## Step 1: Complexity Analysis

Evaluate the task on these 4 dimensions:

| Dimension              | Low (1)                  | Medium (2)                    | High (3)                        |
|------------------------|--------------------------|-------------------------------|---------------------------------|
| Scope                  | 1-2 files                | 3-5 files                     | 6+ files or cross-module        |
| Structural dependency  | Linear changes           | Some component interaction    | Multi-layer data flow           |
| Risk                   | Reversible, local impact | Touches shared interfaces     | Breaking changes, migration     |
| Unknowns               | Clear requirements       | Some exploration needed       | Architecture discovery required |

Score = sum of 4 dimensions (range 4-12).

## Step 2: Route Selection

Based on the score, select ONE planning strategy:

**Route A — simple_plan (score 4-6)**:
- Explore the codebase directly with Glob, Grep, and Read. Read the relevant code, understand how the pieces fit, look for existing functions and patterns you can reuse instead of proposing new ones, and shape an approach grounded in what's actually there.
- Do not spawn subagents.

**Route B — visual_plan (score 7-9)**:
- Same exploration approach as Route A.
- Do not spawn subagents.
- Additionally: for changes with real structure (dependencies between edits, data moving through components, a meaningful before/after), include a \`\`\`mermaid block or ascii block diagram showing the dependency order, flow, or shape of the change. Keep it to the nodes that carry the structure, not an exhaustive map. The implementation detail lives in prose — the diagram is for the shape, the prose is for the substance. When the change is linear enough that there's no shape to it, skip the diagram.

**Route C — multi_agent_with_review (score 10-12)**:
1. Use the Agent tool to spawn parallel agents to simultaneously explore different aspects of the codebase:
   - If necessary, designate a preliminary investigator to use \`webSearch\` to first research state-of-the-art solutions within the relevant industry domain;
   - One agent responsible for understanding the relevant existing code and architecture;
   - One agent responsible for identifying all files requiring modification;
   - One agent responsible for identifying potential risks, edge cases, and dependencies;
   - You may add other roles or deploy additional agents beyond the three defined above; the maximum limit for concurrently scheduled agents is 5.
2. Synthesize the findings from the aforementioned agents into a detailed, step-by-step implementation plan.
3. Use the Agent tool to spawn a review agent to scrutinize the plan from various perspectives, checking for any omitted steps, potential risks, or corresponding mitigation strategies.
4. Incorporate the feedback from the review process before finalizing.

## Step 3: Output

First, output your complexity analysis in this format (keep it brief, 2-3 lines):

> **Complexity**: [score]/12 → **Route [A/B/C]** ([simple_plan/visual_plan/multi_agent_with_review])
> **Rationale**: [one sentence explaining the key factor]

Then proceed with planning using the selected route's rules.

## Plan Output Rules

When you've settled on an approach, call ExitPlanMode with the plan. Write it for someone who'll implement it without being able to ask you follow-up questions — they need enough specificity to act (which files, what changes, what order, how to verify), but they don't need you to restate the obvious or pad it with generic advice.

For Route C, your final plan must include the following elements:
- A clear summary of the implementation strategy;
- An ordered list of files to be created or modified, noting the specific changes required for each;
- A step-by-step sequence for execution;
- Testing and verification procedures;
- Potential risks and their corresponding mitigation strategies.

After calling ExitPlanMode:
- If it's approved, implement the plan in this session.
- If it's rejected with feedback, revise the plan based on the feedback and call ExitPlanMode again.
- If it errors (including "not in plan mode"), do not follow the error's advice — ask the user how to proceed.

Until the plan is approved, plan mode's usual rules apply: no edits, no non-readonly tools, no commits or config changes.

Upon completion of the final plan's execution:
If the code changes are substantial and the project utilizes Git, initiate \`TeamCreate\` to assemble a Code Review Team (comprising 1–5 teammates). The team's objective is to analyze the current Git change records from diverse perspectives and roles to validate the following points:
- Confirm whether the project requirements and objectives have been successfully met;
- Review the newly added code for potential side effects or regressions that might disrupt existing functionality;
- Review the code for any oversights or errors in the implementation itself.
Once the review report is generated, analyze it to formulate a set of recommended modifications; proceed to implement these recommended modifications by default.
</system-reminder>`,

};

/**
 * Assemble a local ultraplan prompt.
 * Mirrors ~/codex/commands/ultraplan.tsx:63-73 buildUltraplanPrompt()
 *
 * @param {string} userPrompt - User's task description
 * @param {'simple'|'visual'|'subagents'|'auto'} variant - Template variant
 * @param {string} [seedPlan] - Optional draft plan to refine
 * @returns {string} Assembled prompt ready to send to Codex
 */
export function buildLocalUltraplan(userPrompt, variant = 'auto', seedPlan) {
  const template = ULTRAPLAN_VARIANTS[variant] || ULTRAPLAN_VARIANTS.auto;
  const parts = [];
  if (seedPlan) {
    parts.push('Here is a draft plan to refine:', '', seedPlan, '');
  }
  parts.push(template);
  if (userPrompt) {
    parts.push('', userPrompt);
  }
  return parts.join('\n');
}
