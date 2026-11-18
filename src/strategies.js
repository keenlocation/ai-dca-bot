export function createGrid({reference,capital=1000,range=4,intervals=8,fee=.1,geometric=false}) {
 if(![reference,capital,range,intervals,fee].every(Number.isFinite)||reference<=0||capital<=0||range<=0||range>=90||!Number.isInteger(intervals)||intervals<2||intervals>40||fee<0||fee>10)return null;
 const low=reference*(1-range/100),high=reference*(1+range/100),allocation=capital/(intervals+1);
 const levels=Array.from({length:intervals+1},(_,i)=>geometric?low*(high/low)**(i/intervals):low+(high-low)*i/intervals);
 const cycles=levels.slice(0,-1).map((buy,i)=>({buy,sell:levels[i+1],net:allocation*((levels[i+1]*(1-fee/100))/(buy*(1+fee/100))-1)}));
 return {low,high,levels,allocation,cycles,reference,capital};
}
export function replayDca(candles,{budget=100,interval=7,days=84,fee=.1}={}) {
 if(![budget,interval,days,fee].every(Number.isFinite)||budget<=0||interval<1||days<1||fee<0||fee>10||!candles.length)return null;
 const end=candles.at(-1).time,start=end-(days-1)*86400000;
 const series=candles.filter(c=>c.time>=start&&c.time<=end&&Number.isFinite(c.close)&&c.close>0);
 if(series.length<2)return null;
 let units=0,invested=0,lastBuy=-Infinity;const purchases=[];
 const points=series.map(c=>{
  if(c.time-lastBuy>=interval*86400000){units+=budget/(c.close*(1+fee/100));invested+=budget;lastBuy=c.time;purchases.push({time:c.time,price:c.close,amount:budget,units:budget/(c.close*(1+fee/100))});}
  return {time:c.time,price:c.close,units,invested,value:units*c.close,avg:invested/units,count:purchases.length};
 });
 const last=points.at(-1),lumpUnits=invested/(points[0].price*(1+fee/100));
 return {points,purchases,final:last,lumpValue:lumpUnits*last.price,firstPrice:points[0].price};
}
export function triggerMatches(quote,{target,direction='below'},now=Date.now()) {
 return !!quote&&quote.status==='ok'&&Number.isFinite(target)&&target>0&&now-quote.receivedAt<=30000&&quote.receivedAt<=now+5000&&(direction==='below'?quote.ask<=target:direction==='above'?quote.ask>=target:false);
}
export function paperFill(quote,{budget=1000,fee=.1,slippage=.05},now=Date.now()) {
 if(!quote||quote.status!=='ok'||now-quote.receivedAt>30000||!Number.isFinite(quote.ask)||quote.ask<=0||![budget,fee,slippage].every(Number.isFinite)||budget<=0||fee<0||fee>10||slippage<0||slippage>10)return null;
 const price=quote.ask*(1+slippage/100),units=budget/(price*(1+fee/100));
 return {price,units,budget,fee,slippage,exchange:quote.name,receivedAt:quote.receivedAt,filledAt:now,depthExceeded:quote.askSize!=null&&units>quote.askSize};
}
