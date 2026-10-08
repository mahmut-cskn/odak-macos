"""Generate original geometric Odak assets using only Python's standard library."""
import math, struct, zlib
from pathlib import Path

def png(file, size, tray=False):
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            a, b = (x + .5) / size, (y + .5) / size
            if tray:
                visible = ((a-.5)**2/.32**2+(b-.57)**2/.3**2 < 1) or (.44 < a < .57 and .15 < b < .32) or ((a-.62)**2/.18**2+(b-.23)**2/.06**2 < 1)
                color = (0,0,0,255 if visible else 0)
                if (a-.51)**2+(b-.56)**2 < .11**2: color = (0,0,0,0)
            else:
                corner = max(abs(a-.5)-.31,0)**2+max(abs(b-.5)-.31,0)**2
                color=(30,65,55,255) if corner < .17**2 else (0,0,0,0)
                radius=math.hypot(a-.5,b-.54)
                if .19 < radius < .29: color=(236,242,214,255)
                if .474<a<.526 and .31<b<.54: color=(236,242,214,255)
                if .5<a<.63 and abs(b-.54)<.026: color=(236,242,214,255)
                if ((a-.57)/.14)**2+((b-.225)/.055)**2 < 1: color=(189,214,147,255)
            row.extend(color)
        rows.append(row)
    def chunk(kind, content): return struct.pack('>I',len(content))+kind+content+struct.pack('>I',zlib.crc32(kind+content)&0xffffffff)
    Path(file).write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows),9))+chunk(b'IEND',b''))
png('src-tauri/icons/source.png',1024)
png('src-tauri/icons/tray.png',44,True)
