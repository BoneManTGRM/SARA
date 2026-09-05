/** Six physical requests, <= $0.15 conservative reserved cost. No refunds on uncertainty. */
export class PhysicalBudget {
 calls=0; reserved=0;
 readonly #open=new Set<number>();
 reserve():number{
  if(this.calls>=6||this.reserved+0.025>0.15000000001)throw Error('PHYSICAL_LIMIT');
  const id=++this.calls;this.reserved+=0.025;this.#open.add(id);return id;
 }
 settle(reservation:number,measured:number|null):void{
  if(!this.#open.has(reservation))throw Error('UNKNOWN_RESERVATION');
  if(measured!==null&&(!Number.isFinite(measured)||measured<0||measured>0.025))throw Error('INVALID_COST');
  this.#open.delete(reservation);if(measured!==null)this.reserved+=measured-0.025;
 }
}
