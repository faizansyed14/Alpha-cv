"""Domain-specific AI agents (interview questions, LinkedIn job posts).

Each agent is a small, auditable pipeline, not a general chatbot:

    gate (no model call) -> token budget -> grounded prompt -> ONE model call -> output validation -> append-only history

There is no framework behind it on purpose: the agents make a single structured call per turn and have no tools that can
change anything, so an orchestration library would add moving parts without adding safety. Layout:

    interview/   the Interview Question Agent  (prompt.py, parser.py, spec.py)
    linkedin/    the LinkedIn Job Post Agent   (prompt.py, parser.py, spec.py)
    base.py      AgentSpec and the shared rules text
    registry.py  the agents that exist
    scope.py     what every agent refuses without calling the model
    usage.py     token budget per person, global ceiling, admin reset
    store.py     the append-only history
    runtime.py   one turn, start to finish
"""
