from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Slug = Annotated[str, Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class StudioManifest(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    name: str
    default_printer: Slug
    product_lines: list[Slug] = Field(default_factory=list)
    registry_index: str = ".aps/registry.yaml"


class ProductLineManifest(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    slug: Slug
    name: str
    description: str = ""
    audience: list[str] = Field(default_factory=list)
    design_language: list[str] = Field(default_factory=list)
    default_workflow: list[str] = Field(
        default_factory=lambda: ["brief", "design", "review", "print-validation", "release"]
    )
    variants: list[Slug] = Field(default_factory=list)


class VariantManifest(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    slug: Slug
    name: str
    theme: str = ""
    palette: dict[str, str] = Field(default_factory=dict)
    constraints: list[str] = Field(default_factory=list)
    products: list[Slug] = Field(default_factory=list)


class Component(StrictModel):
    name: str
    role: str
    material_group: str | None = None
    required: bool = True


class ProductManifest(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    slug: Slug
    name: str
    summary: str = ""
    intended_use: str = ""
    dimensions_mm: dict[str, float] = Field(default_factory=dict)
    printer_profile: Slug = "generic-fdm"
    components: list[Component] = Field(default_factory=list)
    output_formats: list[str] = Field(default_factory=lambda: ["blend", "stl", "3mf", "png"])


class AssetKind(StrEnum):
    SOURCE = "source"
    EXPORT = "export"
    PACKAGE = "package"
    PREVIEW = "preview"
    BACKUP = "backup"
    DOCUMENT = "document"


class AssetRecord(StrictModel):
    path: str
    kind: AssetKind
    format: str
    role: str
    sha256: str
    size_bytes: int = Field(ge=0)
    source: str | None = None
    release_eligible: bool = True

    @field_validator("path")
    @classmethod
    def require_relative_path(cls, value: str) -> str:
        path = Path(value)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("asset paths must be relative and remain inside the product directory")
        return path.as_posix()


class AssetManifest(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    product: Slug
    generated_at: datetime
    assets: list[AssetRecord] = Field(default_factory=list)


class WorkflowStage(StrEnum):
    BRIEF = "brief"
    DESIGN = "design"
    REVIEW = "review"
    PRINT_VALIDATION = "print-validation"
    RELEASE = "release"


WORKFLOW_ORDER = list(WorkflowStage)


class WorkflowEvent(StrictModel):
    stage: WorkflowStage
    at: datetime
    note: str


class WorkflowManifest(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    product: Slug
    current_stage: WorkflowStage = WorkflowStage.BRIEF
    approvals: dict[str, str] = Field(default_factory=dict)
    blockers: list[str] = Field(default_factory=list)
    physical_print_status: Literal["pending", "passed", "failed"] = "pending"
    history: list[WorkflowEvent] = Field(default_factory=list)


class PrinterProfile(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    slug: Slug
    name: str
    technology: Literal["FDM"] = "FDM"
    build_volume_mm: dict[str, float]
    nozzle_diameter_mm: float = Field(gt=0)
    minimum_wall_mm: float = Field(gt=0)
    minimum_detail_mm: float = Field(gt=0)
    supports_ams: bool = True
    max_ams_colors: int = Field(ge=1)
    package_format: Literal["3mf"] = "3mf"
    slicing: Literal["manual"] = "manual"


class ReleaseManifest(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    product: Slug
    version: str
    created_at: datetime
    printer_profile: Slug
    asset_hashes: dict[str, str]
    validations: list[str]
    physical_print_status: Literal["pending", "passed", "failed"]
    notes: str = ""

    @model_validator(mode="after")
    def require_assets_and_validation(self) -> ReleaseManifest:
        if not self.asset_hashes:
            raise ValueError("a release must include at least one asset hash")
        if not self.validations:
            raise ValueError("a release must include validation results")
        return self
