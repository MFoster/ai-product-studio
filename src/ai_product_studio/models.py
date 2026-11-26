from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

Slug = Annotated[str, Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")]
DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


def _product_asset_path(value: str) -> str:
    path = Path(value)
    if path.is_absolute() or ".." in path.parts or "\\" in value or value in {"", "."}:
        raise ValueError("references must be relative POSIX paths inside the product directory")
    return path.as_posix()


ProductAssetPath = Annotated[str, AfterValidator(_product_asset_path)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class StudioManifest(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    name: str
    default_printer: Slug
    material_config: str = "config/material/material.yaml"
    product_lines: list[Slug] = Field(default_factory=list)
    registry_index: str = ".aps/registry.yaml"

    @field_validator("material_config")
    @classmethod
    def require_relative_material_config(cls, value: str) -> str:
        path = Path(value)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("material_config must be a path inside the studio")
        return path.as_posix()


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


class GroupMaterial(StrictModel):
    id: Slug
    name: DisplayName
    color: Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]
    material: Slug = "pla"


class GroupMesh(StrictModel):
    asset: ProductAssetPath
    material: Slug
    sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]

    @field_validator("asset")
    @classmethod
    def require_stl(cls, value: str) -> str:
        if not value.startswith("export/") or Path(value).suffix.lower() != ".stl":
            raise ValueError("group meshes must reference STL assets under export/")
        return value


class GroupPart(StrictModel):
    id: Slug
    name: DisplayName
    quantity: Annotated[int, Field(ge=1, strict=True)] = 1
    meshes: list[GroupMesh] = Field(min_length=1)

    @model_validator(mode="after")
    def require_unique_meshes(self) -> GroupPart:
        paths = [mesh.asset for mesh in self.meshes]
        if len(set(paths)) != len(paths):
            raise ValueError("a physical part cannot contain the same mesh twice")
        return self


class GroupLayout(StrictModel):
    spacing_mm: float = Field(default=6, gt=0, allow_inf_nan=False)
    margin_mm: float = Field(default=5, ge=0, allow_inf_nan=False)
    orientation: Literal["preserve-source"] = "preserve-source"


class AssetGroup(StrictModel):
    id: Slug
    name: DisplayName
    revision: DisplayName
    description: str = ""
    package: ProductAssetPath
    materials: list[GroupMaterial] = Field(min_length=1)
    parts: list[GroupPart] = Field(min_length=1)
    layout: GroupLayout = Field(default_factory=GroupLayout)

    @field_validator("package")
    @classmethod
    def require_package_target(cls, value: str) -> str:
        if not value.startswith("package/") or Path(value).suffix.lower() != ".3mf":
            raise ValueError("group package targets must be 3MF paths under package/")
        return value

    @model_validator(mode="after")
    def require_unique_parts_and_materials(self) -> AssetGroup:
        part_ids = [part.id for part in self.parts]
        material_ids = [material.id for material in self.materials]
        if len(set(part_ids)) != len(part_ids) or len(set(material_ids)) != len(material_ids):
            raise ValueError("part IDs and material IDs must be unique within a group")
        unknown = {mesh.material for part in self.parts for mesh in part.meshes} - set(material_ids)
        if unknown:
            raise ValueError(
                f"group meshes reference unknown materials: {', '.join(sorted(unknown))}"
            )
        return self


class GroupManifest(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    product: Slug
    groups: list[AssetGroup] = Field(default_factory=list)

    @model_validator(mode="after")
    def require_unique_groups_and_packages(self) -> GroupManifest:
        ids = [group.id for group in self.groups]
        packages = [group.package for group in self.groups]
        if len(set(ids)) != len(ids) or len(set(packages)) != len(packages):
            raise ValueError("group IDs and package targets must be unique within a product")
        return self


class AssetManifest(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    product: Slug
    generated_at: datetime
    assets: list[AssetRecord] = Field(default_factory=list)
    groups: list[AssetGroup] = Field(default_factory=list)

    @model_validator(mode="after")
    def require_valid_groups(self) -> AssetManifest:
        GroupManifest(product=self.product, groups=self.groups)
        return self


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
    supports_multi_material: bool = False
    max_material_slots: int = Field(ge=1)
    supported_materials: list[Slug] = Field(
        default_factory=lambda: ["pla"],
        min_length=1,
    )
    slicer: str = "Generic slicer"
    package_format: Literal["3mf", "stl"] = "3mf"
    slicing: Literal["manual"] = "manual"

    @field_validator("build_volume_mm")
    @classmethod
    def require_positive_build_volume(cls, value: dict[str, float]) -> dict[str, float]:
        required = {"x", "y", "z"}
        if set(value) != required or any(value[axis] <= 0 for axis in required):
            raise ValueError("build_volume_mm must contain positive x, y, and z dimensions")
        return value

    @model_validator(mode="after")
    def require_consistent_material_slots(self) -> PrinterProfile:
        if not self.supports_multi_material and self.max_material_slots != 1:
            raise ValueError("max_material_slots must be 1 when multi-material support is disabled")
        return self


class SliceProfile(StrictModel):
    """A record of the slicer settings a product was or will be printed with.

    ``captured`` profiles are extracted from a real slicer project file and are
    evidence. ``stated`` profiles are hand-recorded assumptions and must never
    be presented as evidence of how a part was actually printed.
    """

    schema_version: Literal["1.0"] = "1.0"
    slug: Slug
    name: str
    product: Slug
    printer_profile: Slug
    evidence: Literal["captured", "stated"] = "captured"
    recorded_at: datetime
    source: str | None = None
    source_sha256: str | None = None
    settings_file: str | None = None
    settings_sha256: str | None = None
    slicer: str = "Bambu Studio"
    slicer_version: str | None = None
    printer_model: str | None = None
    printer_settings_id: str | None = None
    print_settings_id: str | None = None
    filament_settings_ids: list[str] = Field(default_factory=list)
    filament_types: list[str] = Field(default_factory=list)
    nozzle_diameter_mm: float = Field(gt=0)
    layer_height_mm: float = Field(gt=0)
    first_layer_height_mm: float = Field(gt=0)
    wall_loops: int = Field(ge=1)
    sparse_infill_density: str | None = None
    support_enabled: bool = False
    support_type: str | None = None
    brim_type: str | None = None
    build_plate: str | None = None
    notes: list[str] = Field(default_factory=list)

    @field_validator("source", "settings_file")
    @classmethod
    def require_relative_reference(cls, value: str | None) -> str | None:
        if value is None:
            return None
        path = Path(value)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("slice profile references must stay inside the product directory")
        return path.as_posix()

    @model_validator(mode="after")
    def require_evidence_for_captured(self) -> SliceProfile:
        if self.evidence == "captured" and not (self.source and self.settings_file):
            raise ValueError(
                "captured slice profiles must reference the project file and extracted settings"
            )
        return self


class TemperatureRange(StrictModel):
    minimum: int
    maximum: int

    @model_validator(mode="after")
    def require_ordered_range(self) -> TemperatureRange:
        if self.maximum < self.minimum:
            raise ValueError("maximum temperature must be greater than or equal to minimum")
        return self


class MaterialProfile(StrictModel):
    slug: Slug
    name: str
    nozzle_temperature_c: TemperatureRange
    bed_temperature_c: TemperatureRange
    minimum_wall_mm: float = Field(gt=0)
    shrink_compensation_percent: float = Field(ge=0)
    notes: list[str] = Field(default_factory=list)


class MaterialConfiguration(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    materials: list[MaterialProfile] = Field(min_length=1)

    @model_validator(mode="after")
    def require_unique_materials(self) -> MaterialConfiguration:
        slugs = [material.slug for material in self.materials]
        if len(slugs) != len(set(slugs)):
            raise ValueError("material slugs must be unique")
        return self


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
