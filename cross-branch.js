'use strict';

// Extra connections use vehicle IDs, so they stay attached when the tree is reordered.
function cleanCrossConnections ( links ) {
	if ( !Array.isArray( links ) ) return [];
	const known = new Set( vehicleList.map( vehicle => vehicle.id ) );
	const seen = new Set();
	return links.filter( link => {
		if ( !link || typeof link.from !== 'string' || typeof link.to !== 'string' ||
			link.from === link.to || !known.has( link.from ) || !known.has( link.to ) ) return false;
		const key = link.from + ':' + link.to;
		if ( seen.has( key ) ) return false;
		seen.add( key );
		return true;
	} ).map( link => ( { from: link.from, to: link.to } ) );
}

function setCrossConnections ( links ) {
	const clean = cleanCrossConnections( links );
	crossConnections.splice( 0, crossConnections.length, ...clean );
	localStorage.setItem( 'crossConnections', JSON.stringify( crossConnections ) );
}

function svgNode ( tag, attributes ) {
	const element = document.createElementNS( 'http://www.w3.org/2000/svg', tag );
	for ( const [ name, value ] of Object.entries( attributes ) ) {
		element.setAttribute( name, value );
	}
	return element;
}


function badgeBounds ( badge, root ) {
	const rect = badge.getBoundingClientRect();
	return {
		left: rect.left - root.left, right: rect.right - root.left,
		top: rect.top - root.top, bottom: rect.bottom - root.top,
		x: ( rect.left + rect.right ) / 2 - root.left,
		y: ( rect.top + rect.bottom ) / 2 - root.top
	};
}

function connectionPort ( box, side ) {
	const horizontal = side === 'left' || side === 'right';
	const direction = side === 'right' || side === 'bottom' ? 1 : -1;
	const edge = box[ side ];
	return horizontal ? {
		x: edge + direction * 11, y: box.y,
		endX: edge + direction * 3, endY: box.y, axis: 1
	} : {
		x: box.x, y: edge + direction * 11,
		endX: box.x, endY: edge + direction * 3, axis: 2
	};
}

// Keep the first and last segments anchored to the vehicle edges.
function routeBetweenBadges ( from, to, boxes, width, height, usedPaths ) {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const horizontal = dx >= 0 ? [ 'right', 'left' ] : [ 'left', 'right' ];
	const vertical = dy >= 0 ? [ 'bottom', 'top' ] : [ 'top', 'bottom' ];
	const choices = Math.abs( dx ) > 60 && Math.abs( dy ) < 110 ?
		[ horizontal, vertical ] : Math.abs( dy ) > Math.abs( dx ) * 1.4 ?
		[ vertical, horizontal ] : [ horizontal, vertical ];

	let best = null;
	for ( const pair of choices ) {
		const start = connectionPort( from, pair[ 0 ] );
		const finish = connectionPort( to, pair[ 1 ] );
		const result = findClearRoute( start, finish, boxes, width, height, usedPaths );
		if ( !result ) continue;

		const score = result.score + ( pair === choices[ 0 ] ? 0 : 25 );
		if ( !best || score < best.score ) {
			best = { score, points: [
				[ start.endX, start.endY ], ...result.points, [ finish.endX, finish.endY ]
			] };
		}
	}
	return best ? tidyPath( best.points ) : null;
}

function segmentsOverlap ( a, b, previousPaths ) {
	for ( const path of previousPaths ) {
		for ( let i = 1; i < path.length; i++ ) {
			const c = path[ i - 1 ];
			const d = path[ i ];
			if ( a[ 0 ] === b[ 0 ] && c[ 0 ] === d[ 0 ] && a[ 0 ] === c[ 0 ] &&
				Math.max( Math.min( a[ 1 ], b[ 1 ] ), Math.min( c[ 1 ], d[ 1 ] ) ) <
				Math.min( Math.max( a[ 1 ], b[ 1 ] ), Math.max( c[ 1 ], d[ 1 ] ) ) ) return true;
			if ( a[ 1 ] === b[ 1 ] && c[ 1 ] === d[ 1 ] && a[ 1 ] === c[ 1 ] &&
				Math.max( Math.min( a[ 0 ], b[ 0 ] ), Math.min( c[ 0 ], d[ 0 ] ) ) <
				Math.min( Math.max( a[ 0 ], b[ 0 ] ), Math.max( c[ 0 ], d[ 0 ] ) ) ) return true;
		}
	}
	return false;
}

// Find a short right-angled route through the gaps between vehicle badges.
function findClearRoute ( start, finish, boxes, width, height, usedPaths ) {
	const clearance = 9;
	const minX = Math.max( 1, Math.min( start.x, finish.x ) - 85 );
	const maxX = Math.min( width - 1, Math.max( start.x, finish.x ) + 85 );
	const minY = Math.max( 1, Math.min( start.y, finish.y ) - 85 );
	const maxY = Math.min( height - 1, Math.max( start.y, finish.y ) + 85 );

	const obstacles = boxes.filter( box =>
		box.right + clearance >= minX && box.left - clearance <= maxX &&
		box.bottom + clearance >= minY && box.top - clearance <= maxY
	).map( box => ( {
		left: box.left - clearance, right: box.right + clearance,
		top: box.top - clearance, bottom: box.bottom + clearance
	} ) );

	const xs = new Set( [ start.x, finish.x, minX, maxX ] );
	const ys = new Set( [ start.y, finish.y, minY, maxY ] );
	for ( const box of obstacles ) {
		if ( box.left > minX && box.left < maxX ) xs.add( box.left );
		if ( box.right > minX && box.right < maxX ) xs.add( box.right );
		if ( box.top > minY && box.top < maxY ) ys.add( box.top );
		if ( box.bottom > minY && box.bottom < maxY ) ys.add( box.bottom );
	}
	const x = [ ...xs ].sort( ( a, b ) => a - b );
	const y = [ ...ys ].sort( ( a, b ) => a - b );
	if ( x.length * y.length > 100000 ) return null;
	const nx = x.length;
	const sx = x.indexOf( start.x ), sy = y.indexOf( start.y );
	const tx = x.indexOf( finish.x ), ty = y.indexOf( finish.y );
	if ( sx < 0 || sy < 0 || tx < 0 || ty < 0 ) return null;

	function blocked ( x1, y1, x2, y2 ) {
		for ( const box of obstacles ) {
			if ( x1 === x2 ) {
				if ( x1 > box.left && x1 < box.right &&
					Math.max( y1, y2 ) > box.top && Math.min( y1, y2 ) < box.bottom ) return true;
			} else if ( y1 > box.top && y1 < box.bottom &&
				Math.max( x1, x2 ) > box.left && Math.min( x1, x2 ) < box.right ) return true;
		}
		return false;
	}

	const encode = ( ix, iy, axis ) => ( iy * nx + ix ) * 3 + axis;
	const firstKey = encode( sx, sy, start.axis );
	const distances = new Map( [ [ firstKey, 0 ] ] );
	const previous = new Map();
	const heap = [];

	function push ( item ) {
		heap.push( item );
		let i = heap.length - 1;
		while ( i > 0 ) {
			const p = ( i - 1 ) >> 1;
			if ( heap[ p ].priority <= item.priority ) break;
			heap[ i ] = heap[ p ];
			i = p;
		}
		heap[ i ] = item;
	}
	function pop () {
		const first = heap[ 0 ];
		const last = heap.pop();
		if ( heap.length ) {
			let i = 0;
			while ( 2 * i + 1 < heap.length ) {
				let child = i * 2 + 1;
				if ( child + 1 < heap.length && heap[ child + 1 ].priority < heap[ child ].priority ) child++;
				if ( heap[ child ].priority >= last.priority ) break;
				heap[ i ] = heap[ child ];
				i = child;
			}
			heap[ i ] = last;
		}
		return first;
	}

	push( {
		key: firstKey, ix: sx, iy: sy, axis: start.axis, cost: 0,
		priority: Math.abs( start.x - finish.x ) + Math.abs( start.y - finish.y )
	} );

	while ( heap.length ) {
		const item = pop();
		if ( distances.get( item.key ) !== item.cost ) continue;

		if ( item.ix === tx && item.iy === ty ) {
			let key = item.key;
			const points = [];
			while ( key !== undefined ) {
				const node = Math.floor( key / 3 );
				points.push( [ x[ node % nx ], y[ Math.floor( node / nx ) ] ] );
				key = previous.get( key );
			}
			points.reverse();
			return { points, score: item.cost + ( item.axis !== finish.axis ? 10 : 0 ) };
		}

		for ( const [ ix, iy, axis ] of [
			[ item.ix - 1, item.iy, 1 ], [ item.ix + 1, item.iy, 1 ],
			[ item.ix, item.iy - 1, 2 ], [ item.ix, item.iy + 1, 2 ]
		] ) {
			if ( ix < 0 || ix >= x.length || iy < 0 || iy >= y.length ) continue;
			const a = [ x[ item.ix ], y[ item.iy ] ];
			const b = [ x[ ix ], y[ iy ] ];
			if ( blocked( a[ 0 ], a[ 1 ], b[ 0 ], b[ 1 ] ) ) continue;

			const segment = Math.abs( b[ 0 ] - a[ 0 ] ) + Math.abs( b[ 1 ] - a[ 1 ] );
			const overlap = segmentsOverlap( a, b, usedPaths ) ? 30 : 0;
			const cost = item.cost + segment + ( item.axis !== axis ? 14 : 0 ) + overlap;
			const key = encode( ix, iy, axis );
			if ( cost >= ( distances.get( key ) ?? Infinity ) ) continue;
			distances.set( key, cost );
			previous.set( key, item.key );
			push( {
				key, ix, iy, axis, cost,
				priority: cost + Math.abs( b[ 0 ] - finish.x ) + Math.abs( b[ 1 ] - finish.y )
			} );
		}
	}
	return null;
}

function tidyPath ( input ) {
	const points = [];
	for ( const point of input ) {
		if ( points.length && points[ points.length - 1 ][ 0 ] === point[ 0 ] &&
			points[ points.length - 1 ][ 1 ] === point[ 1 ] ) continue;
		points.push( point );
		while ( points.length >= 3 ) {
			const [ a, b, c ] = points.slice( -3 );
			if ( a[ 0 ] === b[ 0 ] && b[ 0 ] === c[ 0 ] ||
				a[ 1 ] === b[ 1 ] && b[ 1 ] === c[ 1 ] ) points.splice( -2, 1 );
			else break;
		}
	}
	return points;
}

function drawCrossConnections () {
	const tree = document.querySelector( '#techTree' );
	if ( !tree ) return;
	tree.querySelector( ':scope > .crossBranchOverlay' )?.remove();
	if ( !crossConnections.length ) return;

	const root = tree.getBoundingClientRect();
	if ( !root.width || !root.height ) return;
	const overlay = svgNode( 'svg', {
		class: 'crossBranchOverlay',
		width: root.width, height: root.height,
		viewBox: '0 0 ' + root.width + ' ' + root.height,
		'aria-hidden': 'true'
	} );

	const defs = svgNode( 'defs', {} );
	const marker = svgNode( 'marker', {
		id: 'crossBranchArrow', markerWidth: '8', markerHeight: '8',
		refX: '7', refY: '4', orient: 'auto', markerUnits: 'userSpaceOnUse'
	} );
	marker.appendChild( svgNode( 'path', {
		d: 'M 0 0 L 8 4 L 0 8 z', fill: '#8fa9b3'
	} ) );
	defs.appendChild( marker );
	overlay.appendChild( defs );

	const badges = [ ...tree.querySelectorAll( '.vehicleBadge' ) ]
		.filter( badge => !badge.closest( '.folderTooltipText' ) );
	const positions = new Map( badges.map( badge => [ badge.id, badgeBounds( badge, root ) ] ) );
	const boxes = [ ...positions.values() ];
	const usedPaths = [];

	for ( const link of crossConnections ) {
		const from = positions.get( link.from );
		const to = positions.get( link.to );
		if ( !from || !to ) continue;

		const points = routeBetweenBadges( from, to, boxes, root.width, root.height, usedPaths );
		if ( !points ) continue;
		usedPaths.push( points );
		const d = points.map( ( point, i ) =>
			( i ? 'L ' : 'M ' ) +
			( Math.round( point[ 0 ] * 10 ) / 10 ) + ' ' +
			( Math.round( point[ 1 ] * 10 ) / 10 )
		).join( ' ' );
		overlay.appendChild( svgNode( 'path', {
			d, class: 'crossBranchPath',
			'marker-end': 'url(#crossBranchArrow)'
		} ) );
	}
	tree.appendChild( overlay );
}

function updateCrossConnectionList () {
	const fromSelect = document.querySelector( '#crossBranchFrom' );
	const toSelect = document.querySelector( '#crossBranchTo' );
	const list = document.querySelector( '#crossBranchList' );
	const fromId = fromSelect.value;
	const toId = toSelect.value;
	const vehicles = vehicleList.slice().sort( ( a, b ) =>
		a.rank - b.rank || a.branch - b.branch || a.name.localeCompare( b.name )
	);

	for ( const select of [ fromSelect, toSelect ] ) {
		select.replaceChildren();
		for ( const vehicle of vehicles ) {
			const option = document.createElement( 'option' );
			option.value = vehicle.id;
			option.textContent = 'Rank ' + vehicle.rank + ', branch ' + vehicle.branch + ': ' + vehicle.name;
			select.appendChild( option );
		}
	}
	if ( vehicles.some( vehicle => vehicle.id === fromId ) ) fromSelect.value = fromId;
	if ( vehicles.some( vehicle => vehicle.id === toId ) ) toSelect.value = toId;
	else if ( vehicles.length > 1 ) toSelect.selectedIndex = 1;
	document.querySelector( '#crossBranchAdd' ).disabled = vehicles.length < 2;

	list.replaceChildren();
	if ( !crossConnections.length ) {
		const message = document.createElement( 'p' );
		message.textContent = 'No extra connections yet.';
		list.appendChild( message );
	}
	for ( const link of crossConnections ) {
		const from = vehicleList.find( vehicle => vehicle.id === link.from );
		const to = vehicleList.find( vehicle => vehicle.id === link.to );
		if ( !from || !to ) continue;
		const row = document.createElement( 'div' );
		row.className = 'crossBranchRow';
		const text = document.createElement( 'span' );
		text.textContent = from.name + ' (rank ' + from.rank + ') → ' +
			to.name + ' (rank ' + to.rank + ')';
		const remove = document.createElement( 'button' );
		remove.type = 'button';
		remove.textContent = 'Remove';
		remove.dataset.from = link.from;
		remove.dataset.to = link.to;
		row.append( text, remove );
		list.appendChild( row );
	}
}

document.querySelector( '#navCrossBranch' ).addEventListener( 'click', () => {
	closeModal();
	updateCrossConnectionList();
	document.querySelector( '#crossBranchModal' ).style.display = 'block';
	document.body.style.overflow = 'hidden';
} );

document.querySelector( '#crossBranchAdd' ).addEventListener( 'click', () => {
	const from = document.querySelector( '#crossBranchFrom' ).value;
	const to = document.querySelector( '#crossBranchTo' ).value;
	if ( !from || !to || from === to ) {
		window.alert( 'Select two different vehicles.' );
		return;
	}
	if ( crossConnections.some( link => link.from === from && link.to === to ) ) return;
	setCrossConnections( [ ...crossConnections, { from, to } ] );
	drawCrossConnections();
	updateCrossConnectionList();
} );

document.querySelector( '#crossBranchList' ).addEventListener( 'click', event => {
	const remove = event.target.closest( 'button[data-from][data-to]' );
	if ( !remove ) return;
	setCrossConnections( crossConnections.filter( link =>
		link.from !== remove.dataset.from || link.to !== remove.dataset.to
	) );
	drawCrossConnections();
	updateCrossConnectionList();
} );

window.addEventListener( 'resize', drawCrossConnections );
