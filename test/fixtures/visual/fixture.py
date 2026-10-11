#!/usr/bin/env python3
"""Deterministic full-screen GTK fixture; JSON state is independent of the client framebuffer."""
import json
import os
import pathlib
import sys
import time
import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk, Gdk, GLib
import cairo

folder = pathlib.Path(sys.argv[1])
state = {'version': 1, 'sequence': 0, 'input': 'initial', 'platform': 'gnome', 'font': 'DejaVu Sans', 'scale': 1}
started = time.monotonic()
window = Gtk.Window(title='Tabby Visual QA Fixture')
window.set_decorated(False)
window.fullscreen()
area = Gtk.DrawingArea()
window.add(area)
area.set_can_focus(True)
area.add_events(Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.KEY_PRESS_MASK)

def publish():
    tmp = folder / 'state.tmp'
    tmp.write_text(json.dumps(state))
    tmp.replace(folder / 'state.json')

def advance(kind):
    state['sequence'] += 1
    state['input'] = kind
    area.queue_draw()

def draw(widget, cr):
    w, h = widget.get_allocated_width(), widget.get_allocated_height()
    state.update(width=w, height=h, scale=widget.get_scale_factor(), ready=True)
    def rect(x, y, width, height, color):
        cr.set_source_rgb(*[v / 255 for v in color]); cr.rectangle(x, y, width, height); cr.fill()
    def text(x, y, value, size=20):
        cr.set_source_rgb(.9, .94, 1); cr.select_font_face('DejaVu Sans', cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_NORMAL)
        cr.set_font_size(size); cr.move_to(x, y); cr.show_text(value)
    rect(0, 0, w, h, (18, 26, 42))
    for x, y, color in [(0,0,(220,40,60)), (w-48,0,(30,200,80)), (0,h-48,(40,80,220)), (w-48,h-48,(240,200,40))]:
        rect(x,y,48,48,color)
    text(64, 62, 'TABBY / REAL RDP VISUAL QA', 24)
    text(64, 98, 'Aa Bb 0123456789  |  Text, geometry, gradients', 16)
    gradient = cairo.LinearGradient(64, 0, w-64, 0)
    gradient.add_color_stop_rgb(0, .12, .39, .78); gradient.add_color_stop_rgb(1, .94, .78, .16)
    cr.set_source(gradient); cr.rectangle(64, 132, w-128, 80); cr.fill()
    for i, color in enumerate([(255,0,0), (0,255,0), (0,0,255), (255,255,255), (128,128,128), (0,0,0)]):
        rect(64+i*80, 240, 64, 64, color)
    text(64, 344, 'REMOTE FRAME %02d' % state['sequence'])
    rect(64, h-116, 220, 48, (36, 66, 102)); text(80, h-85, 'Advance frame', 18)
    color = (30, 100, 200) if state['sequence'] % 2 == 0 else (240, 200, 40)
    rect(w-160, h-144, 80, 64, color)
    publish()
    return False

def click(widget, event):
    if 64 <= event.x < 284 and state.get('height', 0)-116 <= event.y < state.get('height', 0)-68: advance('mouse')
    area.grab_focus()
    return True

def key(widget, event):
    if event.keyval == Gdk.KEY_space: advance('keyboard')
    return True

def tick():
    try:
        command = json.loads((folder/'command.json').read_text())
        (folder/'command.json').unlink()
        if command.get('quit'): Gtk.main_quit(); return False
        if command.get('reset') and state['sequence'] != 0:
            state.update(sequence=0, input='reset'); area.queue_draw()
    except (FileNotFoundError, ValueError): pass
    if time.monotonic()-started > 300: Gtk.main_quit(); return False
    return True

area.connect('draw', draw)
area.connect('button-press-event', click)
area.connect('key-press-event', key)
window.connect('destroy', Gtk.main_quit)
window.show_all(); area.grab_focus()
GLib.timeout_add(100, tick)
try: Gtk.main()
finally:
    state['ready'] = False
    publish()
