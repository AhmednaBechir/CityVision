from sqlalchemy import Column, String, Integer, DateTime, func
from .db import Base

class ParkingSnapshot(Base):
    __tablename__ = "parking_snapshots"
    id         = Column(Integer, primary_key=True)
    parking_id = Column(String, index=True)
    nb_free    = Column(Integer, nullable=True)
    nb_total   = Column(Integer, nullable=True)
    ts         = Column(DateTime(timezone=True), server_default=func.now())

class TramEvent(Base):
    __tablename__ = "tram_events"
    id        = Column(Integer, primary_key=True)
    line_id   = Column(String, index=True)
    stop_id   = Column(String)
    scheduled = Column(Integer)
    actual    = Column(Integer, nullable=True)
    ts        = Column(DateTime(timezone=True), server_default=func.now())