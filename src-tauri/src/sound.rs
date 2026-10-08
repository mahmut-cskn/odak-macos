use rodio::{buffer::SamplesBuffer, OutputStream, Sink};
use std::{f32::consts::PI, thread};
pub fn play(phase: &str, volume: f32) {
    let notes = if phase == "work" {
        [523.25, 659.25]
    } else {
        [659.25, 880.0]
    };
    thread::spawn(move || {
        let Ok((_stream, handle)) = OutputStream::try_default() else {
            return;
        };
        let Ok(sink) = Sink::try_new(&handle) else {
            return;
        };
        let rate = 44100;
        let mut samples = vec![];
        for frequency in notes {
            for index in 0..(rate as f32 * 0.32) as usize {
                let time = index as f32 / rate as f32;
                let envelope = (time / 0.025).min(1.0) * ((0.32 - time) / 0.18).clamp(0.0, 1.0);
                samples.push((2.0 * PI * frequency * time).sin() * envelope * 0.22);
            }
            samples.extend(vec![0.0; (rate as f32 * 0.05) as usize]);
        }
        sink.set_volume(volume.clamp(0.0, 1.0));
        sink.append(SamplesBuffer::new(1, rate, samples));
        sink.sleep_until_end();
    });
}
