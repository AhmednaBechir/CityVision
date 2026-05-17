"""
Database models for Mreso Transport Visualizer.

Tables:
  - tram_lines          : static line metadata + geometry
  - tram_stops          : static stop metadata
  - stop_time_snapshots : collected real-time arrival data (for analytics)
  - parking_locations   : static parking metadata
  - parking_snapshots   : collected availability snapshots (for analytics)
"""

from datetime import datetime
from sqlalchemy import (
    String, Float, Integer, Boolean, DateTime, JSON, ForeignKey, Text, Index
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class TramLine(Base):
    __tablename__ = "tram_lines"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)   # e.g. "SEM_A"
    code: Mapped[str] = mapped_column(String(20))                    # "A"
    long_name: Mapped[str] = mapped_column(String(200))
    color: Mapped[str | None] = mapped_column(String(7))             # hex
    text_color: Mapped[str | None] = mapped_column(String(7))
    mode: Mapped[str] = mapped_column(String(20), default="TRAM")
    geometry: Mapped[dict | None] = mapped_column(JSON)              # GeoJSON LineString
    stops_ordered: Mapped[list | None] = mapped_column(JSON)         # ordered stop IDs
    total_distance_m: Mapped[float | None] = mapped_column(Float)
    travel_time_s: Mapped[int | None] = mapped_column(Integer)       # scheduled end-to-end
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    snapshots: Mapped[list["StopTimeSnapshot"]] = relationship("StopTimeSnapshot", back_populates="line")


class TramStop(Base):
    __tablename__ = "tram_stops"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)   # e.g. "SEM:CHAVANT"
    name: Mapped[str] = mapped_column(String(200))
    lon: Mapped[float] = mapped_column(Float)
    lat: Mapped[float] = mapped_column(Float)
    lines: Mapped[list | None] = mapped_column(JSON)                 # list of line codes serving this stop
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    snapshots: Mapped[list["StopTimeSnapshot"]] = relationship("StopTimeSnapshot", back_populates="stop")


class StopTimeSnapshot(Base):
    """
    Every time we poll real-time arrivals we record:
      - scheduled departure
      - real-time departure (if available)
      - delay in seconds
    This powers: delay probability, reliability score, historical punctuality.
    """
    __tablename__ = "stop_time_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    line_id: Mapped[str] = mapped_column(String(50), ForeignKey("tram_lines.id"))
    stop_id: Mapped[str] = mapped_column(String(50), ForeignKey("tram_stops.id"))
    trip_id: Mapped[str | None] = mapped_column(String(100))
    scheduled_departure: Mapped[datetime | None] = mapped_column(DateTime)
    realtime_departure: Mapped[datetime | None] = mapped_column(DateTime)
    delay_seconds: Mapped[int | None] = mapped_column(Integer)       # positive = late
    is_realtime: Mapped[bool] = mapped_column(Boolean, default=False)
    collected_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    line: Mapped["TramLine"] = relationship("TramLine", back_populates="snapshots")
    stop: Mapped["TramStop"] = relationship("TramStop", back_populates="snapshots")

    __table_args__ = (
        Index("ix_snapshots_line_collected", "line_id", "collected_at"),
        Index("ix_snapshots_stop_collected", "stop_id", "collected_at"),
    )


class ParkingLocation(Base):
    __tablename__ = "parking_locations"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)   # from API
    name: Mapped[str] = mapped_column(String(200))
    lon: Mapped[float] = mapped_column(Float)
    lat: Mapped[float] = mapped_column(Float)
    capacity: Mapped[int | None] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(20), default="PAR")     # PAR or PKG
    zone: Mapped[str | None] = mapped_column(String(50))             # derived zone label
    address: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    snapshots: Mapped[list["ParkingSnapshot"]] = relationship("ParkingSnapshot", back_populates="parking")


class ParkingSnapshot(Base):
    """
    Collected every N seconds for occupancy-over-time + congestion detection.
    """
    __tablename__ = "parking_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    parking_id: Mapped[str] = mapped_column(String(50), ForeignKey("parking_locations.id"))
    available: Mapped[int | None] = mapped_column(Integer)
    occupied: Mapped[int | None] = mapped_column(Integer)
    occupancy_pct: Mapped[float | None] = mapped_column(Float)       # 0-100
    is_open: Mapped[bool | None] = mapped_column(Boolean)
    collected_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    parking: Mapped["ParkingLocation"] = relationship("ParkingLocation", back_populates="snapshots")

    __table_args__ = (
        Index("ix_parking_snapshots_pid_collected", "parking_id", "collected_at"),
    )
