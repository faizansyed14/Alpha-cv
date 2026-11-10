"""Boolean search strings for the CV database (the kind recruiters paste from Naukri / LinkedIn).

    ("Cloud Engineer") AND ("Azure" OR "Terraform" OR "Kubernetes") NOT intern

Grammar (operators are upper case so a lower-case "and" inside a phrase stays a word):

    expr    := and ( OR and )*
    and     := not ( [AND] not )*          two terms side by side mean AND
    not     := NOT not | atom
    atom    := "( expr )" | "quoted phrase" | word

Matching is exact, against the normalised literal text of the CV: a word matches as a
whole word and a quoted phrase as that exact phrase, ignoring case, so "Java" never matches a JavaScript-only CV.
``to_sql`` turns the expression into the same test as an SQL condition on the ``literal`` search text, so the database
decides exactly; ``evaluate`` is the in-memory form of the same rule.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Tuple

from app.ingestion.search_index import normalize

MAX_QUERY_CHARS = 4000
MAX_NODES = 300

_TOKEN = re.compile(r'\s*(?:(?P<lp>\()|(?P<rp>\))|"(?P<q>[^"]*)"|(?P<w>[^\s()"]+))')


class BooleanQueryError(ValueError):
    """The pasted string is not a valid boolean search."""


@dataclass
class Node:
    kind: str                       # "term" | "and" | "or" | "not"
    term: str = ""                  # normalised term, for kind == "term"
    shown: str = ""                 # the term as typed, for highlighting
    children: List["Node"] = field(default_factory=list)


def _tokenize(text: str) -> List[Tuple[str, str]]:
    tokens: List[Tuple[str, str]] = []
    pos = 0
    text = text.replace("“", '"').replace("”", '"')   # curly quotes from Word / email
    while pos < len(text):
        m = _TOKEN.match(text, pos)
        if not m:
            if text[pos:].strip():
                raise BooleanQueryError("Unreadable search string")
            break
        pos = m.end()
        if m.group("lp"):
            tokens.append(("(", "("))
        elif m.group("rp"):
            tokens.append((")", ")"))
        elif m.group("q") is not None:
            tokens.append(("phrase", m.group("q")))
        elif m.group("w") in ("AND", "OR", "NOT"):
            tokens.append((m.group("w"), m.group("w")))
        else:
            tokens.append(("word", m.group("w")))
    return tokens


class _Parser:
    def __init__(self, tokens: List[Tuple[str, str]]):
        self.t = tokens
        self.i = 0
        self.nodes = 0

    def peek(self) -> str:
        return self.t[self.i][0] if self.i < len(self.t) else "end"

    def take(self) -> Tuple[str, str]:
        tok = self.t[self.i]
        self.i += 1
        return tok

    def _count(self) -> None:
        self.nodes += 1
        if self.nodes > MAX_NODES:
            raise BooleanQueryError("The search string is too complex")

    def expr(self) -> Node:
        items = [self.and_()]
        while self.peek() == "OR":
            self.take()
            items.append(self.and_())
        if len(items) == 1:
            return items[0]
        self._count()
        return Node("or", children=items)

    def and_(self) -> Node:
        items = [self.not_()]
        while True:
            if self.peek() == "AND":
                self.take()
                items.append(self.not_())
            elif self.peek() in ("word", "phrase", "(", "NOT"):
                items.append(self.not_())
            else:
                break
        if len(items) == 1:
            return items[0]
        self._count()
        return Node("and", children=items)

    def not_(self) -> Node:
        if self.peek() == "NOT":
            self.take()
            self._count()
            return Node("not", children=[self.not_()])
        return self.atom()

    def atom(self) -> Node:
        kind = self.peek()
        if kind == "(":
            self.take()
            inner = self.expr()
            if self.peek() != ")":
                raise BooleanQueryError("A bracket is not closed")
            self.take()
            return inner
        if kind in ("word", "phrase"):
            _, raw = self.take()
            term = normalize(raw)
            if not term:
                raise BooleanQueryError("An empty term in the search string")
            self._count()
            return Node("term", term=term, shown=raw.strip())
        if kind == "end":
            raise BooleanQueryError("The search string ends too early")
        raise BooleanQueryError(f"Unexpected '{self.t[self.i][1]}' in the search string")


def parse(query: str) -> Node:
    query = (query or "").strip()
    if not query:
        raise BooleanQueryError("The search string is empty")
    if len(query) > MAX_QUERY_CHARS:
        raise BooleanQueryError("The search string is too long")
    parser = _Parser(_tokenize(query))
    node = parser.expr()
    if parser.peek() != "end":
        raise BooleanQueryError("Unbalanced brackets or a stray operator")
    return node


def evaluate(node: Node, search_text: str) -> bool:
    """Whether a CV (its normalised search_text) satisfies the expression."""
    return _eval(node, f" {search_text or ''} ")


def _eval(node: Node, padded: str) -> bool:
    if node.kind == "term":
        return f" {node.term} " in padded
    if node.kind == "and":
        return all(_eval(c, padded) for c in node.children)
    if node.kind == "or":
        return any(_eval(c, padded) for c in node.children)
    return not _eval(node.children[0], padded)


def positive_terms(node: Node, negated: bool = False) -> List[Node]:
    """Terms that count FOR a CV (not under NOT), for the "matched" chips; duplicates removed."""
    found: List[Node] = []
    if node.kind == "term":
        if not negated:
            found.append(node)
    else:
        for c in node.children:
            found.extend(positive_terms(c, negated or node.kind == "not"))
    seen, out = set(), []
    for n in found:
        if n.term not in seen:
            seen.add(n.term)
            out.append(n)
    return out


def to_sql(node: Node, column, fts: bool = False):
    """The expression as an SQLAlchemy condition on a column holding the normalised text: the same rule as ``evaluate``
    (a term is a whole word or exact phrase), so no second check is needed. ``column`` is e.g. CandidateSearch.literal.
    With ``fts`` the column is a PostgreSQL tsvector (CandidateSearch.literal_tsv) and a term is a full-text phrase match."""
    from sqlalchemy import and_, func, literal, literal_column, not_, or_

    padded = literal(" ") + column + literal(" ")
    if node.kind == "term":
        if fts:
            return column.op("@@")(func.phraseto_tsquery(literal_column("'simple'::regconfig"), node.term))
        return padded.like(f"% {node.term} %")
    if node.kind == "and":
        return and_(*[to_sql(c, column, fts) for c in node.children])
    if node.kind == "or":
        return or_(*[to_sql(c, column, fts) for c in node.children])
    return not_(to_sql(node.children[0], column, fts))


def to_narrowing(node: Node, column):
    """A cheaper condition every matching CV passes (a superset), written so a trigram index can serve it: the positive
    terms as plain substring tests. None = cannot narrow (e.g. a NOT-only expression). ``to_sql`` still decides."""
    from sqlalchemy import and_, or_

    if node.kind == "term":
        return column.like(f"%{node.term}%")
    if node.kind == "not":
        return None
    parts = [to_narrowing(c, column) for c in node.children]
    if node.kind == "and":
        usable = [p for p in parts if p is not None]
        return and_(*usable) if usable else None
    if any(p is None for p in parts):
        return None
    return or_(*parts)
