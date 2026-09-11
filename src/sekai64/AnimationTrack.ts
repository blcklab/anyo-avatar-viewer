import { AnimationTrack } from '@blcklab/sekai64/animation';
/** Match glTF STEP's right-continuous key boundaries without patching the peer. */
export class ViewerAnimationTrack extends AnimationTrack {
  override sample(time: number, target = new Float32Array(this.valueSize)): Float32Array {
    if (this.interpolation !== 'step') return super.sample(time, target);
    let low = 0, high = this.times.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.times[middle]! <= time) low = middle + 1;
      else high = middle;
    }
    const index = Math.max(0, low - 1);
    target.set(this.values.subarray(index * this.valueSize, (index + 1) * this.valueSize));
    return target;
  }
}
