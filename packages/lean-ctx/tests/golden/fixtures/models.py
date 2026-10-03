"""Domain models for the billing service.

Longer description that is not part of the summary.
"""

from __future__ import annotations

import os.path as osp, sys
from dataclasses import dataclass, field
from typing import TYPE_CHECKING
from ..core.base import BaseModel as Base, registry
from . import utils
from .constants import *

if TYPE_CHECKING:
    from .invoices import Invoice

__all__ = ["Customer", "load_customers", "DEFAULT_CURRENCY"]

DEFAULT_CURRENCY = "EUR"
_CACHE: dict[str, "Customer"] = {}
SUPPORTED_COUNTRIES = ["IT", "FR", "DE", "ES", "PT", "NL", "BE", "AT", "IE", "FI", "SE", "DK", "PL", "CZ"]

# Comment that must disappear.
@dataclass(frozen=True)
class Customer(Base):
    """A paying customer."""

    id: str
    name: str
    invoices: list[Invoice] = field(default_factory=list)  # trailing comment

    @property
    def display_name(self) -> str:
        """Name shown in the UI."""
        return self.name.title()

    @display_name.setter
    def display_name(self, value: str) -> None:
        object.__setattr__(self, "name", value)

    def _internal(self):
        pass

    def __repr__(self) -> str:
        return f"Customer({self.id})"

    class Meta:
        table = "customers"


async def load_customers(path: str, *, limit: int = 100) -> list[Customer]:
    """Load customers from disk.

    Raises:
        FileNotFoundError: when the file is missing.
    """
    def parse(line: str) -> Customer:
        return Customer(*line.split(","))

    with open(path) as handle:
        return [parse(line) for line in handle][:limit]


def _private_helper(): return None


def one_liner(x: int) -> int: return x * 2


type CustomerId = str

if __name__ == "__main__":
    print(load_customers(sys.argv[1]))
