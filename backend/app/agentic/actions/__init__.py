"""Confirmed actions: how Agentic mode CHANGES anything.

The model can only PROPOSE a change. A proposal is a card on the person's screen with a short plain list of what will happen
and two buttons, Confirm and Cancel. Nothing is changed until the person confirms, and the change is then made by code in
``executor.py`` (no model involved) with the details that were SAVED with the proposal, never with anything the browser or the
model sends at confirm time.

Rules this package keeps:

* no action deletes, removes or resets anything (``catalog`` has no such kind, and the gateway has no DELETE)
* one proposal waits at a time, and it can be confirmed only while it is the latest thing in the conversation
* the signed-in person's own token and role are used for the change, so the application's own permission checks apply
* every executed or cancelled proposal is saved in the conversation history, which is the audit trail
"""
