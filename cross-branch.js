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

function findTreeBadge ( id ) {
	return [ ...document.querySelectorAll( '#techTree .vehicleBadge' ) ].find( badge =>
		badge.id === id && !badge.closest( '.folderTooltipText' )
	);
}

function drawCrossConnections () {
	const tree = document.querySelector( '#techTree' );
	if ( !tree ) return;
	tree.querySelector( ':scope > .crossBranchOverlay' )?.remove();
	if ( !crossConnections.length ) return;

	const treeRect = tree.getBoundingClientRect();
	if ( !treeRect.width || !treeRect.height ) return;

	const overlay = svgNode( 'svg', {
		class: 'crossBranchOverlay',
		width: treeRect.width,
		height: treeRect.height,
		viewBox: '0 0 ' + treeRect.width + ' ' + treeRect.height,
		'aria-hidden': 'true'
	} );
	const defs = svgNode( 'defs', {} );
	const marker = svgNode( 'marker', {
		id: 'crossBranchArrow',
		markerWidth: '9', markerHeight: '9',
		refX: '7', refY: '4.5',
		orient: 'auto', markerUnits: 'userSpaceOnUse'
	} );
	marker.appendChild( svgNode( 'path', { d: 'M 0 0 L 9 4.5 L 0 9 z', fill: '#8fa9b3' } ) );
	defs.appendChild( marker );
	overlay.appendChild( defs );

	function position ( node ) {
		const rect = node.getBoundingClientRect();
		return {
			left: rect.left - treeRect.left, right: rect.right - treeRect.left,
			top: rect.top - treeRect.top, bottom: rect.bottom - treeRect.top,
			x: ( rect.left + rect.right ) / 2 - treeRect.left,
			y: ( rect.top + rect.bottom ) / 2 - treeRect.top
		};
	}

	for ( const link of crossConnections ) {
		const first = findTreeBadge( link.from );
		const second = findTreeBadge( link.to );
		if ( !first || !second ) continue;
		const a = position( first );
		const b = position( second );
		const sameRank = first.closest( '.rank' ) === second.closest( '.rank' );
		let path;

		if ( sameRank && Math.abs( a.x - b.x ) > 40 ) {
			const right = b.x > a.x;
			const start = right ? a.right + 2 : a.left - 2;
			const end = right ? b.left - 5 : b.right + 5;

			if ( Math.abs( a.x - b.x ) < 210 ) {
				const middle = ( start + end ) / 2;
				path = 'M ' + start + ' ' + a.y + ' H ' + middle +
					' V ' + b.y + ' H ' + end;
			} else {
				const rank = position( first.closest( '.rank' ) );
				const lane = Math.max( rank.top + 5, Math.min( a.top, b.top ) - 10 );
				const exit = start + ( right ? 12 : -12 );
				path = 'M ' + start + ' ' + a.y + ' H ' + exit +
					' V ' + lane + ' H ' + b.x + ' V ' + ( b.top - 5 );
			}
		} else if ( b.y >= a.y ) {
			const middle = ( a.bottom + b.top ) / 2;
			path = 'M ' + a.x + ' ' + ( a.bottom + 2 ) + ' V ' + middle +
				' H ' + b.x + ' V ' + ( b.top - 5 );
		} else {
			const middle = ( a.top + b.bottom ) / 2;
			path = 'M ' + a.x + ' ' + ( a.top - 2 ) + ' V ' + middle +
				' H ' + b.x + ' V ' + ( b.bottom + 5 );
		}

		overlay.appendChild( svgNode( 'path', {
			d: path, class: 'crossBranchPath',
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
