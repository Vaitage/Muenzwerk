"""Sparziele: anlegen, ändern, archivieren.

Das Geld bleibt auf dem Girokonto. Gespeichert werden nur die Vorgaben; Rate,
Fortschritt und Prognose rechnet die App aus den Umsätzen (web/analytics.js,
`goalsReport`), genauso wie die Übersicht.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from . import db

router = APIRouter(prefix="/api/goals")

MONTH = r"^\d{4}-(0[1-9]|1[0-2])$"
ICON = r"^[A-Za-z][A-Za-z0-9]{0,29}$"   # Schlüssel aus web/icons.js
MAX_CENTS = 10**12


def get_db():
    with db.session() as conn:
        yield conn


class GoalIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    icon: str = Field(default="piggy", pattern=ICON)
    target_cents: int = Field(gt=0, le=MAX_CENTS)
    target_month: str | None = Field(default=None, pattern=MONTH)
    monthly_cents: int | None = Field(default=None, gt=0, le=MAX_CENTS)
    start_month: str = Field(pattern=MONTH)
    start_cents: int = Field(default=0, ge=0, le=MAX_CENTS)

    @model_validator(mode="after")
    def date_or_rate(self):
        # Mit Datum ergibt sich die Rate; ohne Datum braucht es eine feste Rate.
        if self.target_month is None and self.monthly_cents is None:
            raise ValueError("Bitte ein Datum oder eine Monatsrate angeben.")
        if self.target_month is not None and self.target_month < self.start_month:
            raise ValueError("Das Datum liegt vor dem Start.")
        return self


class GoalPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    icon: str | None = Field(default=None, pattern=ICON)
    target_cents: int | None = Field(default=None, gt=0, le=MAX_CENTS)
    target_month: str | None = Field(default=None, pattern=MONTH)
    monthly_cents: int | None = Field(default=None, gt=0, le=MAX_CENTS)
    start_cents: int | None = Field(default=None, ge=0, le=MAX_CENTS)
    archived: bool | None = None
    clear_target_month: bool = False      # Datum entfernen (dann gilt die feste Rate)


def _goal(row) -> dict:
    return {
        "id": row["id"], "name": row["name"], "icon": row["icon"],
        "target_cents": row["target_cents"], "target_month": row["target_month"],
        "monthly_cents": row["monthly_cents"], "start_month": row["start_month"],
        "start_cents": row["start_cents"], "archived": bool(row["archived"]),
    }


@router.get("")
def list_goals(conn=Depends(get_db)):
    return [_goal(r) for r in conn.execute("SELECT * FROM savings_goals ORDER BY archived, id")]


@router.post("", status_code=201)
def create_goal(body: GoalIn, conn=Depends(get_db)):
    cur = conn.execute(
        "INSERT INTO savings_goals (name, icon, target_cents, target_month, monthly_cents, start_month, start_cents) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (body.name.strip(), body.icon, body.target_cents, body.target_month,
         None if body.target_month else body.monthly_cents, body.start_month, body.start_cents),
    )
    return _goal(conn.execute("SELECT * FROM savings_goals WHERE id = ?", (cur.lastrowid,)).fetchone())


@router.patch("/{goal_id}")
def update_goal(goal_id: int, body: GoalPatch, conn=Depends(get_db)):
    row = conn.execute("SELECT * FROM savings_goals WHERE id = ?", (goal_id,)).fetchone()
    if row is None:
        raise HTTPException(404)
    new = _goal(row)
    for key in ("icon", "target_cents", "target_month", "monthly_cents", "start_cents", "archived"):
        value = getattr(body, key)
        if value is not None:
            new[key] = value
    if body.name is not None:
        new["name"] = body.name.strip()
    if body.clear_target_month:
        new["target_month"] = None
    if new["target_month"] is None and not new["monthly_cents"]:
        raise HTTPException(422, "Bitte ein Datum oder eine Monatsrate angeben.")
    if new["target_month"] is not None and new["target_month"] < new["start_month"]:
        raise HTTPException(422, "Das Datum liegt vor dem Start.")
    conn.execute(
        "UPDATE savings_goals SET name = ?, icon = ?, target_cents = ?, target_month = ?, monthly_cents = ?, "
        "start_cents = ?, archived = ? WHERE id = ?",
        (new["name"], new["icon"], new["target_cents"], new["target_month"],
         None if new["target_month"] else new["monthly_cents"], new["start_cents"], int(new["archived"]), goal_id),
    )
    return _goal(conn.execute("SELECT * FROM savings_goals WHERE id = ?", (goal_id,)).fetchone())


@router.delete("/{goal_id}", status_code=204)
def delete_goal(goal_id: int, conn=Depends(get_db)):
    conn.execute("DELETE FROM savings_goals WHERE id = ?", (goal_id,))
