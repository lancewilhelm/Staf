# Staf

Language for persistent conversations, retained knowledge, and observable agent work.

## Language

**Staf instance**:
A running Staf installation that owns its agents, conversations and work, and
accepts connections from clients.
_Avoid_: Browser session, agent

**Agent**:
A named assistant with its own soul, agent memory, and persistent main chat.
_Avoid_: Bot, task, session

**Agent configuration**:
The owner-maintained identity, soul, and provider and model choices that govern
an agent's behavior.
_Avoid_: Conversation history, provider credentials

**Soul**:
An agent's standing instructions, including its role, personality, values,
communication style, and approach to its work.
_Avoid_: Memory, conversation history

**Agent message**:
An actual message from one agent to another requesting help, conveying relevant
context, asking a question, or returning a result.
_Avoid_: Transcript copy, invented dialogue

**Main chat**:
The persistent conversation through which the user talks to and directs an agent.
_Avoid_: Task, Activity

**Task**:
A piece of work carried out for an agent, with an objective, progress, and an outcome.
_Avoid_: Agent, main chat

**Task attempt**:
One execution of a task objective with its own progress and outcome. A retry is a
new attempt linked to the previous attempt, whose record remains intact.
_Avoid_: Resumed attempt, overwritten history

**Memory**:
Information intentionally retained for reuse beyond the conversation in which it
was supplied.
_Avoid_: Transcript, conversation history

**Agent memory**:
Memory specific to one agent.
_Avoid_: User memory, soul

**User memory**:
Memory about the user retained for use across all their agents.
_Avoid_: Agent memory, conversation history

**Conversation history**:
The record of messages exchanged in a conversation.
_Avoid_: Memory

**Activity**:
The visible record of actual agent work, including exchanged messages, actions,
tool outcomes, and results.
_Avoid_: Hidden reasoning, invented agent dialogue

**Agent permissions**:
The authority an agent has to use tools and access resources while carrying out work.
_Avoid_: Approval mode, task scope

**Task scope**:
The objective and bounds of the work authorized for a task.
_Avoid_: Agent permissions, approval mode

**Approval mode**:
The rule determining when an agent must ask the owner before taking an action
within its permissions and task scope.
_Avoid_: Permissions, off

**Approval grant**:
The owner's authorization for an action or bounded set of actions, with a stated
scope and duration.
_Avoid_: Agent permissions, approval mode

**Remembered approval**:
An approval grant for a defined type of future action, scoped to an agent or
explicitly across the owner's agents.
_Avoid_: Unrestricted permission, approval mode

**Pairing code**:
A one-time code displayed by a Staf instance to authorize a new client.
_Avoid_: Provider credential, account password

**Paired client**:
A browser or CLI client authorized to access an owner's Staf instance until
that authorization is revoked.
_Avoid_: Agent, provider account

**Creation defaults**:
Initial configuration values copied into a new agent. Changing these defaults
affects agents created afterward, while existing agents keep their own configuration.
_Avoid_: Live inheritance, shared agent configuration
