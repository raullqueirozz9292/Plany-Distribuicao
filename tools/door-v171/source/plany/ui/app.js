(function () {
  'use strict';
  var M = window.MyDinaModel, U = window.PlanyUi, $ = function (id) { return document.getElementById(id); };
  function countText(n,one,many){return n+' '+(Number(n)===1?one:many);}
  var nativeMode = !!(window.sketchup && typeof window.sketchup.ready === 'function');
  var state = { params: M.clone(M.defaults), target: null, extras: [], moduleMaterials: [], pieceElevations: {}, selected: 'root', dirty: false, busy: false };
  var operations=new window.PlanyOperations('panel-'+Math.random().toString(36).slice(2)),editorContext=null,openingSessionId=null;
  var flow=new window.PlanyInsertionSessions(operations);
  var modelConfig=null,materialGroup=null;
  var standaloneTrim=null,trimEditorHome=$('trim-editor').parentNode;
  var userDefaults=M.clone(M.defaults),pieceEdges=[],pieceEditorBaseline=null,previewDrag=null,cutOffcuts=[];
  var userSettings={thicknesses:[6,15,18,25],structure_material:'Branco TX',front_material:'Branco TX',hidden_material:'Retalho',surplus_enabled:true,base_type:'under',bottom_type:'full',top_join:'over',top_type:'full',back:true,back_type:'applied',back_setback:10,back_groove_depth:5,back_panel_type:'full',theme:'light',precision:1,command_suggestions:true,command_stay_active:true,command_space_as_enter:false,command_aliases:{}};
  var commandCatalog=[];
  var volumeContext=null,volumeStep='general',componentEditorOpening=false;
  var editorHomes={};['front-editor','cladding-editor','trim-editor'].forEach(function(id){editorHomes[id]=$(id).parentNode;});
  var settingsThicknessDraft=userSettings.thicknesses.slice(),settingsReturnTab='module',settingsReturnScroll=0,settingsPage='index';
  var drafts={},selectionKey=null,selectionKind='empty',selectionPayload={},bulkChanges={},baseParams=null,baseElevation=0;
  var nativeEditError=null,editRejection=null;
  var cutStep=1,stockSizes={};
  var pieceExportPending=false;
  var divisionEdit=null,divisionBatch=null,internalPending=false,piecesView=false,pieceEditorOpen=false,piecesScrollTop=0,pieceEditorAxes=[0,1],editingCladding=null,editingTrim=null,editingAccessory=null;
  var pendingRemoval=null,lastUndo=null,undoRestorePending=false,undoTimer=null;
  var commandInsertPending=false;
  var libraryUndo=null,libraryUndoTimer=null;
  var editingFrontNodes=null,frontTargetChanging=false;
  var drawerOpeningKey='',drawerDepthManual=false,drawerHeightManual=false,drawerHeightRequested=null,drawerDepthReference=null;
  var centralSetupStep='';
  var insertionPrefs={};
  try{insertionPrefs=JSON.parse(window.localStorage.getItem('plany.insertion.prefs')||'{}')||{};}catch(_){insertionPrefs={};}
  var pinnedNumbers={};
  try{pinnedNumbers=JSON.parse(window.localStorage.getItem('plany.pinned.numbers.v1')||'{}')||{};}catch(_){pinnedNumbers={};}
  var pinFactories={
    'batente-depth':70,'division-position':50,'division-front-recess':0,
    'drawer-height-difference':5,'drawer-recess':22,'drawer-clearance':14,
    'drawer-runner-height':44,'drawer-runner-drop':10,'drawer-base-clearance':10,'drawer-front-projection':15,
    'front-gap':3,'front-gap-left':3,'front-gap-right':3,'front-gap-top':3,'front-gap-bottom':3,
    'cladding-front':20,'cladding-rear':0,'cladding-rail-depth':70,
    'trim-height':100,'trim-foot-height':15,'trim-setback':50,'trim-setback-back':0,
    'trim-setback-left':0,'trim-setback-right':0,'trim-max-opening':600,
    'trim-crown-setback-left':0,'trim-crown-setback-right':0,'trim-crown-setback-back':0
  };
  var pinRanges={
    rail_width:[30,300],bottom_rail_width:[30,300],back_rail_width:[30,300],back_setback:[0,300],back_groove_depth:[.1,39],
    'batente-depth':[10,1500],'division-position':[0,100],'division-front-recess':[0,1500],
    'drawer-height-difference':[0,500],'drawer-recess':[0,1500],'drawer-clearance':[0,100],
    'drawer-runner-height':[1,200],'drawer-runner-drop':[0,100],'drawer-base-clearance':[0,100],'drawer-front-projection':[0,300],
    'front-gap':[-100,100],'front-gap-left':[-100,100],'front-gap-right':[-100,100],
    'front-gap-top':[-100,100],'front-gap-bottom':[-100,100],
    'cladding-front':[0,300],'cladding-rear':[0,300],'cladding-rail-depth':[10,1500],
    'trim-height':[20,1000],'trim-foot-height':[1,990],'trim-setback':[0,500],
    'trim-setback-back':[0,500],'trim-setback-left':[0,500],'trim-setback-right':[0,500],
    'trim-max-opening':[100,4000],
    'trim-crown-setback-left':[0,500],'trim-crown-setback-right':[0,500],'trim-crown-setback-back':[0,500]
  };
  var drawerGapFields=['front-gap-bottom','front-gap-top','front-gap-left','front-gap-right'];
  function drawerGapKind(fit){return 'drawers:'+(fit==='inset'?'inset':'overlay');}
  function drawerGapFactory(id,fit){return id==='front-gap-bottom'&&fit!=='inset'?0:3;}
  // Old pins had no fit identity. Keep them once under the last saved fit;
  // never copy the same shared values into both profiles on later reloads.
  function migrateDrawerGapPins(){
    if(drawerGapFields.some(function(id){return pinnedNumbers[drawerGapKind('overlay')+':'+id]!==undefined||pinnedNumbers[drawerGapKind('inset')+':'+id]!==undefined;}))return;
    var fit=(insertionPrefs.drawers||{}).fit,changed=false;
    drawerGapFields.forEach(function(id){var value=pinnedNumbers['drawers:'+id];if(typeof value==='number'&&Number.isFinite(value)&&value>=-100&&value<=100){pinnedNumbers[drawerGapKind(fit)+':'+id]=value;changed=true;}});
    if(changed)try{window.localStorage.setItem('plany.pinned.numbers.v1',JSON.stringify(pinnedNumbers));}catch(_){}
  }
  migrateDrawerGapPins();
  function loadDrawerGapDefaults(){
    if($('front-kind').value!=='drawers')return;
    var fit=$('front-fit').value;
    drawerGapFields.forEach(function(id){$(id).value=pinNumber(drawerGapKind(fit),id,drawerGapFactory(id,fit));});
    refreshPins();
  }
  function pinKind(id){
    if(id==='batente-depth')return 'divider';
    if(id.indexOf('trim-')===0)return $('trim-kind').value;
    if(id.indexOf('division-')===0)return divisionEdit&&divisionEdit.axis==='vertical'?'divider':'shelf';
    if(drawerGapFields.indexOf(id)>=0&&$('front-kind').value==='drawers')return drawerGapKind($('front-fit').value);
    if(id.indexOf('front-gap')===0)return $('front-kind').value==='drawers'?'drawers':'door';
    if(id.indexOf('drawer-')===0)return 'drawers';
    return 'cladding';
  }
  function pinNumber(kind,id,factory){
    var value=pinnedNumbers[kind+':'+id];
    return value===undefined?factory:value;
  }
  function pinFactory(id){
    if(id==='trim-setback'&&$('trim-kind').value==='crown')return 0;
    if(drawerGapFields.indexOf(id)>=0&&$('front-kind').value==='drawers')return drawerGapFactory(id,$('front-fit').value);
    return pinFactories[id];
  }
  function pinCurrentDefault(id){
    return Object.prototype.hasOwnProperty.call(pinFactories,id)?pinNumber(pinKind(id),id,pinFactory(id)):userDefaults[id];
  }
  function refreshPins(){
    document.querySelectorAll('.pin-default-button').forEach(function(button){
      var id=button.dataset.pinField,input=$(id),value=Number(String(input.value).trim().replace(',','.'));
      var supported=!(id==='division-position'&&$('division-mode').value!=='ratio')&&
        !(id==='drawer-base-clearance'&&$('drawer-runner').value==='telescopic');
      var range=pinRanges[id],valid=input.value.trim()!==''&&Number.isFinite(value)&&value>=range[0]&&value<=range[1];
      button.disabled=!supported||!valid||Math.abs(value-Number(pinCurrentDefault(id)))<0.000001;
      button.title=button.disabled?'Valor já é o padrão ou não pode ser fixado neste campo':'Fixar '+input.closest('label').textContent.trim()+' como padrão';
    });
  }
  function setupPins(){
    Object.keys(pinRanges).forEach(function(id){
      var input=$(id);if(!input)return;
      var button=document.createElement('button');button.type='button';button.className='pin-default-button';
      button.dataset.pinField=id;button.setAttribute('aria-label','Fixar valor como padrão');
      var icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
      icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');
      var shape=document.createElementNS('http://www.w3.org/2000/svg','path');
      shape.setAttribute('d','M16 3l5 5-4 1-3 3 1 4-2 2-7-7 2-2 4 1 3-3 1-4ZM9.5 14.5 4 20');
      icon.appendChild(shape);button.appendChild(icon);
      var wrapper=document.createElement('span');wrapper.className='pin-input';
      input.parentNode.insertBefore(wrapper,input);wrapper.appendChild(input);wrapper.appendChild(button);
      input.addEventListener('input',refreshPins);input.addEventListener('change',refreshPins);
      button.addEventListener('click',function(){
        var value=M.number(input.value,'Novo padrão',pinRanges[id][0],pinRanges[id][1]);
        if(!Object.prototype.hasOwnProperty.call(pinFactories,id)){
          var defaults=M.clone(userDefaults);defaults[id]=value;
          request('save_defaults',[defaults]);
        }else{
          pinnedNumbers[pinKind(id)+':'+id]=value;
          try{window.localStorage.setItem('plany.pinned.numbers.v1',JSON.stringify(pinnedNumbers));}catch(_){}
          message('Novo padrão fixado para futuras inserções.','success');refreshPins();
        }
      });
    });
    refreshPins();
  }
  var selectionSteps=[
    {id:'general-settings',label:'Geral'},
    {id:'construction-settings',label:'Peças e materiais'},
    {id:'front-details',label:'Inserções'}
  ],activeSelectionStep='general-settings';
  var NS = 'http://www.w3.org/2000/svg';
  var insertToolButtons={door:'choose-door',drawers:'choose-drawer',shelf:'add-shelf',divider:'add-divider',cladding:'add-cladding-tool',baseboard:'add-baseboard',crown:'add-crown',accessory:'add-accessory'};
  var insertToolLabels={door:'Porta',drawer:'Gaveta avulsa',drawers:'Gaveta',shelf:'Prateleira',divider:'Divisória',cladding:'Tamponamento',baseboard:'Rodapé',crown:'Rodateto',accessory:'Acessório'};
  function saveInsertionPrefs(){try{window.localStorage.setItem('plany.insertion.prefs',JSON.stringify(insertionPrefs));}catch(_){}}
  function insertionPref(kind){
    var base=kind==='door'?{count:'1',fit:'overlay',gap:'3',gap_left:'3',gap_bottom:'3',gap_top:'3',thickness:null,material:'',side:'front',door_type:'hinged',door_opening:'left',lift_system:'gas'}:
      kind==='drawers'?{count:'1',fit:'overlay',gap:'3',gap_left:'3',gap_right:'3',gap_bottom:'0',gap_top:'3',thickness:null,material:'',side:'front',runner:'telescopic',visibility:'external',clearance:'14',recess:'22',box_height_difference:'5',runner_height:'44',runner_drop:'10',base_clearance:'10',front_projection:'15',hardware_layout_version:1}:
      kind==='shelf'?{mode:'ratio',position:50,thickness:null,quantity:'1',type:'mdf',fixation:'screw',material:'',front_recess:'0',glass_color:'clear',led:false,led_position:'front'}:
      {mode:'ratio',position:50,thickness:null,quantity:'1',type:'mdf',divider_mode:'internal',batente_depth:70,fixation:'screw',material:'',front_recess:'0',glass_color:'clear',led:false,led_position:'front'};
    var stored=insertionPrefs[kind]||{},result={};
    Object.keys(base).forEach(function(key){result[key]=stored[key]===undefined||kind==='drawers'&&(['gap','gap_left','gap_right','gap_bottom','gap_top'].indexOf(key)>=0||stored.hardware_layout_version!==1&&key==='clearance')?base[key]:stored[key];});
    if(kind==='door')['left','right','bottom','top'].forEach(function(edge){
      if(stored['gap_'+edge]===undefined&&stored.gap!==undefined)result['gap_'+edge]=stored.gap;
    });
    var prefIds={gap:'front-gap',gap_left:'front-gap-left',gap_right:'front-gap-right',gap_top:'front-gap-top',gap_bottom:'front-gap-bottom',
      clearance:'drawer-clearance',recess:'drawer-recess',runner_height:'drawer-runner-height',runner_drop:'drawer-runner-drop',
      base_clearance:'drawer-base-clearance',front_projection:'drawer-front-projection',box_height_difference:'drawer-height-difference',
      position:'division-position',front_recess:'division-front-recess',batente_depth:'batente-depth'};
    Object.keys(prefIds).forEach(function(key){if(Object.prototype.hasOwnProperty.call(base,key)){
      var id=prefIds[key],drawerGap=kind==='drawers'&&drawerGapFields.indexOf(id)>=0;
      var factory=drawerGap?drawerGapFactory(id,result.fit):base[key];
      result[key]=pinNumber(drawerGap?drawerGapKind(result.fit):kind,id,factory);
    }});
    return result;
  }
  function setActiveInsertTool(kind){
    if(kind==='drawer_edit')kind='drawers';
    else if(kind&&/_edit$/.test(kind))kind=kind.slice(0,-5);
    flow.tool=kind||null;
    Object.keys(insertToolButtons).forEach(function(key){
      var button=$(insertToolButtons[key]);if(button)button.setAttribute('aria-pressed',String(flow.tool===key));
    });
    if($('insert-tool-hint')){
      var modelTool=flow.tool&&['door','drawers','shelf','divider'].indexOf(flow.tool)>=0;
      $('insert-tool-hint').textContent=flow.tool?
        (modelTool?insertToolLabels[flow.tool]+' ativa · clique em um ou mais vãos no SketchUp. Esc cancela.':'Configure '+insertToolLabels[flow.tool].toLowerCase()+' e conclua a inserção.'):
        'Escolha uma ferramenta. Portas, gavetas, prateleiras e divisórias são aplicadas diretamente nos vãos do SketchUp.';
    }
  }
  function openingTargets(){
    if(flow.openings.length)return flow.openings.slice();
    return flow.opening?[flow.opening]:[];
  }
  function doorSelectionArea(targets){
    if(!targets||!targets.length)return null;
    var x0=Math.min.apply(null,targets.map(function(v){return v.x;}));
    var z0=Math.min.apply(null,targets.map(function(v){return v.z;}));
    var x1=Math.max.apply(null,targets.map(function(v){return v.x+v.width;}));
    var z1=Math.max.apply(null,targets.map(function(v){return v.z+v.height;}));
    return {x:x0,z:z0,width:x1-x0,height:z1-z0,count:targets.length};
  }
  function doorSelectionText(targets){
    var area=doorSelectionArea(targets);if(!area)return '';
    return 'Área selecionada · '+area.count+' '+(area.count===1?'vão':'vãos')+' · '+format(area.width)+' × '+format(area.height)+' mm';
  }
  function insertSessionActive(){return !!flow.creation;}
  function updateInsertGuidance(){
    var box=$('insert-guidance'),text=$('insert-guidance-text');
    if(!box||!text)return;
    var active=insertSessionActive(),kind=active&&flow.creation.kind,count=openingTargets().length;
    box.hidden=!active;
    if(!active)return;
    if(['door','drawers','shelf','divider'].indexOf(kind)>=0){
      if(kind==='door'){
        text.textContent=count?
          doorSelectionText(openingTargets())+'. Clique em outro vão para redefinir/ampliar o retângulo, ou conclua a inserção.':
          'Clique no primeiro vão e depois no limite oposto da área da porta. Os vãos intermediários entram automaticamente.';
      }else text.textContent=count?
        count+(count===1?' vão selecionado. ':' vãos selecionados. ')+'Continue clicando no SketchUp para incluir ou remover, ou conclua a inserção.':
        'Clique em um ou mais vãos no SketchUp. As configurações abaixo já podem ser definidas antes da seleção.';
    }else if(kind==='cladding'){
      text.textContent='Escolha o lado e a montagem. O lado inserido depois cobre os anteriores no encontro.';
    }else if(kind==='baseboard'){
      text.textContent='Defina altura, recuo, espessura e material do rodapé e conclua a inserção.';
    }else if(kind==='crown'){
      text.textContent='Configure a frente e, se desejar, os acabamentos laterais e traseiro do rodateto.';
    }else if(kind==='accessory'){
      text.textContent='Escolha a categoria, descreva o acessório e informe a quantidade antes de concluir.';
    }else text.textContent='Configure a ferramenta e conclua a inserção.';
  }
  function updateInsertTargetCount(){
    if(!$('insert-target-count'))return;
    var active=insertSessionActive(),frontCount=$('insert-target-count'),divisionCount=$('division-target-count');
    frontCount.hidden=!active;if(divisionCount)divisionCount.hidden=!active;
    if(active){
      var targets=openingTargets(),count=targets.length,kind=flow.creation&&flow.creation.kind;
      var text=kind==='door'&&count?
        doorSelectionText(targets)+' · clique em outro vão para redefinir a área.':
        count+(count===1?' vão selecionado':' vãos selecionados')+' · continue clicando no SketchUp para incluir ou remover.';
      frontCount.textContent=text;if(divisionCount)divisionCount.textContent=text;
    }
    updateInsertGuidance();
  }
  function syncDoorControls(){
    if($('front-kind').value!=='door')return;
    var type=$('door-type').value;
    $('door-hinged-field').hidden=type!=='hinged';
    $('door-lift-field').hidden=type!=='lift';
    $('door-sliding-field').hidden=type!=='sliding';
    if(type==='hinged'){
      var mode=$('door-hinged-mode').value;
      $('front-count').value=mode==='double'?'2':'1';
    }else if(type==='lift'){
      // New flaps have one leaf per opening. Preserve old two-leaf recipes
      // on edits rather than silently redesigning saved furniture.
      var legacy=state.editingFront&&(state.params.fronts||[]).find(function(f){return f.id===state.editingFront&&f.door_type==='lift'&&f.count>1;});
      $('front-count').value=legacy?String(legacy.count):'1';
    }else{
      $('front-count').value=$('door-sliding-count').value;
    }
    syncExtraFrontControls();
  }
  function setSelectOptions(id,items,value){
    var select=$(id);select.textContent='';
    items.forEach(function(item){var option=document.createElement('option');option.value=String(item[0]);option.textContent=item[1];select.appendChild(option);});
    if(value!==undefined&&value!==null&&Array.prototype.some.call(select.options,function(o){return o.value===String(value);}))select.value=String(value);
  }
  function divisionKind(){return divisionEdit&&divisionEdit.axis==='horizontal'?'shelf':'divider';}
  function glassMaterialName(color){return {clear:'Vidro Incolor',smoke:'Vidro Fumê',bronze:'Vidro Bronze',green:'Vidro Verde'}[color]||'Vidro Incolor';}
  function glassColorLabel(color){return {clear:'incolor',smoke:'fumê',bronze:'bronze',green:'verde',mirror:'espelho'}[color]||'incolor';}
  function arrangeDivisionEditor(){
    var measures=$('division-measures');
    ['division-position-fields','division-thickness-field','division-front-recess-field','division-span-field','division-depth-field'].forEach(function(id){measures.appendChild($(id));});
    $('division-footer').appendChild($('division-actions'));
  }
  function syncDivisionControls(){
    if(!divisionEdit)return;
    var kind=divisionKind(),type=$('division-type').value,quantity=Number($('division-quantity').value||1),currentThickness=$('division-thickness').value;
    arrangeDivisionEditor();
    $('divider-mode-fields').hidden=kind!=='divider';$('batente-depth-field').hidden=kind!=='divider'||$('divider-mode').value!=='batente';
    $('division-span-field').hidden=kind==='shelf';
    $('division-depth-field').hidden=kind==='shelf'||kind==='divider'&&$('divider-mode').value==='batente';
    $('division-quantity-field').hidden=!insertSessionActive()&&kind!=='divider';
    $('division-distribution-field').hidden=(!insertSessionActive()&&kind!=='divider')||quantity<=1;
    $('division-proportions-field').hidden=false;
    $('division-position-fields').hidden=(insertSessionActive()||kind==='divider')&&quantity>1;
    var thicknesses=type==='glass'?[[4,'4 mm'],[6,'6 mm'],[8,'8 mm'],[10,'10 mm']]:mdfThicknesses(3,40);
    if(type==='mdf'&&currentThickness&&thicknesses.every(function(item){return String(item[0])!==currentThickness;})&&divisionEdit&&!divisionEdit.isNew&&!divisionEdit.pending){
      thicknesses.push([currentThickness,currentThickness.replace('.',',')+' mm · medida atual']);
    }
    var validThickness=thicknesses.some(function(item){return String(item[0])===String(currentThickness);});
    setSelectOptions('division-thickness',thicknesses,validThickness?currentThickness:((type==='glass')?6:(state.params.thickness||15)));
    var fixations;
    if(type==='glass'){
      fixations=kind==='shelf'?[['shelf_support','Suporte de apoio'],['angle','Cantoneira'],['connector','Conector']]:[['connector','Conector']];
    }else{
      fixations=kind==='shelf'?[['screw','Parafusada'],['shelf_support','Suporte de apoio'],['angle','Cantoneira'],['dowel','Cavilhada'],['connector','Conector']]:
        [['screw','Parafusada'],['dowel','Cavilhada'],['connector','Conector']];
    }
    var currentFix=$('division-fixation').value;
    setSelectOptions('division-fixation',fixations,currentFix);
    $('division-material-field').hidden=type!=='mdf';
    $('division-glass-color-field').hidden=type!=='glass';
    var ledVisible=kind==='shelf'&&type==='mdf';
    $('division-led-options').hidden=!ledVisible;
    $('division-led-position-field').hidden=!ledVisible||$('division-led').value!=='led';
    $('division-advanced').hidden=!ledVisible;
    refreshMaterialButtons();
  }
  function captureDivisionPref(){
    var kind=divisionKind();
    return {mode:$('division-mode').value,position:$('division-position').value,thickness:$('division-thickness').value,
      divider_mode:$('divider-mode').value,batente_depth:$('batente-depth').value,quantity:$('division-quantity').value,type:$('division-type').value,fixation:$('division-fixation').value,keep_divider_proportions:$('division-proportions').checked,
      material:$('division-material').value||'',front_recess:$('division-front-recess').value||'0',
      glass_color:$('division-glass-color').value||'clear',
      led:kind==='shelf'&&$('division-type').value==='mdf'&&$('division-led').value==='led',
      led_position:$('division-led-position').value};
  }
  function applyDivisionConstruction(data,pref,p,axis){
    if(axis==='vertical'){
      data.divider_mode=pref.divider_mode||'internal';
      data.batente_depth=M.number(pref.batente_depth||70,'Profundidade do batente',10,1500);
    }else{
      delete data.divider_mode;
      delete data.batente_depth;
    }
    data.thickness=M.number(pref.thickness,'Espessura',3,40);
    data.construction_type=pref.type||'mdf';data.fixation=pref.fixation||'screw';
    data.front_recess=M.number(pref.front_recess===undefined?0:pref.front_recess,'Recuo frontal',0,1500);
    data.led=!!pref.led;data.led_position=pref.led_position||'front';
    if(data.construction_type==='glass'){
      data.glass_color=pref.glass_color||'clear';data.material=glassMaterialName(data.glass_color);
      data.edges=[];delete data.edge_materials;data.grain='free';data.led=false;data.edge_decrement=false;
    }else{
      delete data.glass_color;data.material=pref.material||p.material;
    }
    return data;
  }
  function setNewDivisionFrontBand(data,p,axis){
    if(data.construction_type!=='mdf')return;
    var edge=axis==='vertical'?'u_min':'v_min';
    data.edges=Array.from(new Set((data.edges||[]).concat(edge)));
    data.edge_materials=Object.assign({},data.edge_materials||{});
    data.edge_materials[edge]=p.apparent_material||p.material;
    data.edge_override=true;
  }
  function setKeyboardFocusMode(enabled){
    document.body.classList.toggle('keyboard-focus',!!enabled);
  }
  var numericDrafts=new WeakMap();
  function numericField(field){return field&&field.matches&&field.matches('input[inputmode="decimal"],input[inputmode="numeric"],input[type="number"]')&&!field.disabled;}
  document.addEventListener('focusin',function(event){var field=event.target;if(numericField(field)){var prior=numericDrafts.get(field);if(!prior||!prior.dirty||prior.current!==field.value)numericDrafts.set(field,{text:field.value,current:field.value,base:Number(field.value.replace(',','.')),dirty:false});}},true);
  document.addEventListener('input',function(event){var draft=numericDrafts.get(event.target);if(draft&&!draft.writing){draft.dirty=true;draft.current=event.target.value;}},true);
  function confirmNumber(field){
    var draft=numericDrafts.get(field);if(!numericField(field)||!draft||!draft.dirty||field.value===draft.text)return;
    var signed=field.dataset.numberPolicy==='signed-absolute'&&/^[+-]/.test(field.value.trim());
    var value=M.calculate(field.value,signed?0:draft.base);
    if(field.inputMode!=='numeric'&&!/angle|grain|precision/.test(field.id)&&!((field.id==='division-position'&&$('division-mode').value==='ratio'||field.id==='position-value'&&$('position-mode').value==='ratio')))value=M.cleanMm(value);
    if(field.min!==''&&field.hasAttribute('min')&&value<Number(field.min)||field.max!==''&&field.hasAttribute('max')&&value>Number(field.max))throw new Error('Valor fora dos limites deste campo.');
    if(field.inputMode==='numeric'&&value!==Math.floor(value))throw new Error('Informe uma quantidade inteira.');
    field.value=String(value);draft.text=field.value;draft.current=field.value;draft.base=value;draft.dirty=false;draft.writing=true;
    field.dispatchEvent(new Event('input',{bubbles:true}));draft.writing=false;
  }
  document.addEventListener('focusout',function(event){
    if(!numericField(event.target))return;
    // Relative arithmetic keeps its existing explicit-confirmation semantics.
    if(!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(event.target.value.trim())&&event.target.dataset.numberPolicy!=='signed-absolute')return;
    try{confirmNumber(event.target);}catch(error){message(error.message,'error');}
  },true);
  document.addEventListener('keydown',function(event){
    if(event.key!=='Enter'||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
    if(event.repeat){event.preventDefault();event.stopImmediatePropagation();return;}
    try{confirmNumber(event.target);}catch(error){event.preventDefault();event.stopImmediatePropagation();message(error.message,'error');}
  },true);
  document.addEventListener('click',function(event){
    var button=event.target.closest('button');if(!button||!button.matches('.primary,#primary-action,#piece-footer-action,#apply-batch,#apply-division,#save-trim,#save-accessory,#add-front,#add-cladding,#apply-bulk'))return;
    try{document.querySelectorAll('input[inputmode="decimal"],input[inputmode="numeric"],input[type="number"]').forEach(function(field){if(field.offsetParent!==null)confirmNumber(field);});}catch(error){event.preventDefault();event.stopImmediatePropagation();message(error.message,'error');}
  },true);
  document.addEventListener('keydown',function(event){
    if(event.key==='Tab'||event.key==='Enter'||event.key==='ArrowUp'||event.key==='ArrowDown'||event.key==='ArrowLeft'||event.key==='ArrowRight')setKeyboardFocusMode(true);
  });
  document.addEventListener('mousedown',function(){setKeyboardFocusMode(false);});
  document.addEventListener('pointerdown',function(){setKeyboardFocusMode(false);});
  document.addEventListener('keydown',function(event){
    if(event.key!=='Enter'||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
    var target=event.target;
    if(!target||target.tagName==='TEXTAREA'||target.tagName==='BUTTON'||!target.matches('input:not([type="hidden"]),select'))return;
    var button=null;
    if(target.closest('#module-piece-editor')||target.closest('#solo-piece'))button=$('piece-footer-action');
    else if(target.closest('#bulk-selection'))button=$('apply-bulk');
    else if(target.closest('#piece-rule-editor'))button=$('save-model-behavior');
    else{
      var item=target.closest('.item-editor');
      if(item){
        if(item.id==='front-editor')button=$('add-front');
        else if(item.id==='division-editor')button=$('apply-division');
        else if(item.id==='plany-batch-editor')button=$('apply-batch');
        else if(item.id==='cladding-editor')button=$('add-cladding');
        else if(item.id==='trim-editor')button=$('save-trim');
        else if(item.id==='accessory-editor')button=$('save-accessory');
        else{
          var candidates=item.querySelectorAll('.primary');
          for(var i=0;i<candidates.length;i++){if(!candidates[i].hidden&&candidates[i].offsetParent!==null&&!candidates[i].disabled){button=candidates[i];break;}}
        }
      }
      if(!button&&target.closest('#module-editor'))button=$('primary-action');
    }
    if(!button||button.hidden||button.disabled)return;
    event.preventDefault();event.stopPropagation();
    // Enter persists the current configuration without invoking Concluir.
    // Only an explicit click on Concluir closes the editor.
    button.dispatchEvent(new CustomEvent('click',{bubbles:true,detail:{planyIntent:'apply'}}));
  },true);
  function editorIntent(event){return event&&event.detail&&event.detail.planyIntent||'finish';}
  function applyActiveEditor(id){var button=$(id);if(button&&!button.disabled)button.dispatchEvent(new CustomEvent('click',{detail:{planyIntent:'apply'}}));}
  ['input','change'].forEach(function(type){document.addEventListener(type,function(event){
    if(event.target.closest('.item-editor'))flow.touch();
  },true);});
  var dimensionKeys = ['width','height','depth','thickness','back_thickness','rail_width','bottom_rail_width','back_rail_width','back_setback','back_groove_depth'];
  var constructionKeys = ['base_type','bottom_type','top_type','top_join','back_type','back_panel_type','material','back_material'];
  function setValue(id,value){
    var control=$(id),text=value===undefined||value===null?'':String(value);
    if(control.tagName==='SELECT'&&!Array.prototype.some.call(control.options,function(o){return o.value===text;})){
      var option=document.createElement('option');option.value=text;option.textContent=text+' mm';control.appendChild(option);
    }
    control.value=text;
  }
  function el(tag, attrs, text) {
    var node = document.createElementNS(NS,tag);
    Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key,attrs[key]); });
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function message(text, type) {
    var nativeBox=$('plany-native-edit-error'),revealNative=false;
    if(nativeEditError&&!nativeBox){nativeBox=document.createElement('div');nativeBox.id='plany-native-edit-error';nativeBox.className='plany-operation-feedback error';nativeBox.setAttribute('role','alert');$('tab-module').insertBefore(nativeBox,$('tab-module').firstChild);}
    if(nativeBox){revealNative=!!nativeEditError&&nativeBox.textContent!==nativeEditError.text;nativeBox.hidden=!nativeEditError;nativeBox.textContent=nativeEditError?nativeEditError.text:'';}
    if(nativeEditError&&type!=='error'){text=nativeEditError.text;type='error';}
    if(type==='error'&&editorPolicy)editorPolicy.error(text);
    $('status').textContent = text; $('status').className = type || '';
    if($('piece-footer-status')){$('piece-footer-status').textContent=text;$('piece-footer-status').className=type||'';}
    if($('action-hint')){$('action-hint').textContent=text;$('action-hint').className=type||'';}
    syncFooterStatus();
    if(revealNative)nativeBox.scrollIntoView({block:'nearest'});
  }
  function syncFooterStatus(){
    var status=$('status'),moduleFooter=$('module-footer'),pieceFooter=$('piece-footer'),footer=document.querySelector('footer');
    var insertEditorVisible=['front-footer','division-footer','batch-footer','cladding-footer','trim-footer','accessory-footer']
      .some(function(id){return !$(id).hidden;});
    var idle=!state.busy&&!updateInProgress;
    status.hidden=!pieceFooter.hidden||!moduleFooter.hidden||(idle&&status.className!=='error'&&(insertEditorVisible||status.className!=='success'));
    footer.hidden=status.hidden&&moduleFooter.hidden&&pieceFooter.hidden&&!insertEditorVisible&&$('settings-footer').hidden;
  }
  function selectionStepButton(id){return document.querySelector('[data-selection-step="'+id+'"]');}
  function selectionFocusable(panel){
    return Array.prototype.filter.call(panel.querySelectorAll('input:not([type="hidden"]),select,button'),function(control){
      return !control.disabled&&!control.hidden&&control.offsetParent!==null;
    });
  }
  function focusSelectionControl(control){
    if(!control)return;
    control.focus();
    if(control.tagName==='INPUT'&&control.type!=='checkbox'&&control.type!=='radio'&&typeof control.select==='function')control.select();
  }
  function activateSelectionStep(id,focusFirst){
    if(!selectionSteps.some(function(step){return step.id===id;}))id='general-settings';
    piecesView=false;activeSelectionStep=id;
    selectionSteps.forEach(function(step){
      var panel=$(step.id),button=selectionStepButton(step.id),active=step.id===id;
      if(panel){panel.classList.add('selection-step-panel');panel.classList.toggle('active-selection-step',active);panel.open=true;}
      if(button){button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));}
    });
    var piecesButton=selectionStepButton('pieces-workspace');
    if(piecesButton){piecesButton.classList.remove('active');piecesButton.setAttribute('aria-selected','false');}
    if(!componentEditorOpening)syncComponentStep(id);
    if(focusFirst){
      var panel=$(id);
      window.setTimeout(function(){focusSelectionControl(panel&&selectionFocusable(panel)[0]);},0);
    }
  }
  function setupSelectionSteps(){
    var first=$('general-settings'),tab=$('tab-module'),moduleEditor=$('module-editor');
    if(!first||!tab||!moduleEditor||$('selection-step-tabs'))return;
    var nav=document.createElement('nav');nav.id='selection-step-tabs';nav.className='selection-step-tabs';nav.setAttribute('aria-label','Etapas da seleção');
    selectionSteps.forEach(function(step){
      var panel=$(step.id);if(panel){panel.classList.add('selection-step-panel');panel.open=true;}
      var button=document.createElement('button');button.type='button';button.className='selection-step-tab';button.dataset.selectionStep=step.id;button.textContent=step.label;button.setAttribute('aria-selected','false');
      button.addEventListener('click',function(){activateSelectionStep(step.id,false);updateChrome();document.querySelector('main').scrollTop=0;});
      nav.appendChild(button);
    });
    var piecesButton=document.createElement('button');piecesButton.type='button';piecesButton.className='selection-step-tab';
    piecesButton.dataset.selectionStep='pieces-workspace';piecesButton.textContent='Peças';piecesButton.setAttribute('aria-selected','false');
    piecesButton.addEventListener('click',function(){setPiecesView(true);});
    nav.appendChild(piecesButton);
    tab.insertBefore(nav,moduleEditor);
    moduleEditor.addEventListener('keydown',function(event){
      if(event.key!=='Enter'||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
      var target=event.target;
      if(!target||!target.matches('input:not([type="hidden"]),select'))return;
      event.preventDefault();
      if(target.matches('input[type="checkbox"],input[type="radio"]'))target.click();
      var panel=target.closest('.selection-step-panel');
      if(!panel)return;
      var controls=selectionFocusable(panel),index=controls.indexOf(target);
      if(index>=0&&index<controls.length-1){focusSelectionControl(controls[index+1]);return;}
      var stepIndex=selectionSteps.map(function(step){return step.id;}).indexOf(panel.id);
      if(stepIndex>=0&&stepIndex<selectionSteps.length-1)activateSelectionStep(selectionSteps[stepIndex+1].id,true);
    });
    activateSelectionStep(activeSelectionStep,false);
  }
  function updateSelectionStepAvailability(openingActive){
    selectionSteps.forEach(function(step){
      var button=selectionStepButton(step.id);
      if(button)button.disabled=openingActive&&step.id!=='front-details';
    });
    var piecesButton=selectionStepButton('pieces-workspace');if(piecesButton)piecesButton.disabled=openingActive;
    if(openingActive)activateSelectionStep('front-details',false);
  }
  function setupPiecesWorkspace(){
    if($('pieces-workspace'))return;
    var tab=$('tab-module'),pieces=$('pieces-category'),editor=$('module-piece-editor'),actions=$('selection-piece-actions');
    if(!tab||!pieces||!editor||!actions)return;
    var workspace=document.createElement('section');workspace.id='pieces-workspace';workspace.className='pieces-workspace';workspace.hidden=true;
    workspace.appendChild(pieces);workspace.appendChild(editor);workspace.appendChild(actions);tab.appendChild(workspace);pieces.open=true;
  }
  function setPiecesView(show){
    piecesView=!!show;if(!piecesView)pieceEditorOpen=false;clearInternalEditors();
    var piecesButton=selectionStepButton('pieces-workspace');
    selectionSteps.forEach(function(step){var button=selectionStepButton(step.id);if(button){button.classList.toggle('active',!piecesView&&step.id===activeSelectionStep);button.setAttribute('aria-selected',String(!piecesView&&step.id===activeSelectionStep));}});
    if(piecesButton){piecesButton.classList.toggle('active',piecesView);piecesButton.setAttribute('aria-selected',String(piecesView));}
    updateChrome();document.querySelector('main').scrollTop=pieceEditorOpen?0:0;
  }
  function openModulePieceEditor(role){
    clearEdgeHover();
    piecesScrollTop=document.querySelector('main').scrollTop;
    pieceEditorOpen=true;state.pieceRole=role;$('piece-role').value=role;fillPiece();updateChrome();
    var cached=drafts[selectionKey],pieceDraft=returnContextValid(cached)&&cached.pieceDrafts&&cached.pieceDrafts[role];
    if(pieceDraft){restoreControls(pieceDraft.fields);pieceEdges=pieceDraft.edges.slice();renderEdges();}
    document.querySelector('main').scrollTop=0;
  }
  var batchReturn=null;
  function closeModulePieceEditor(){
    clearEdgeHover();
    rememberDraft();
    if(batchReturn&&batchReturn.key===selectionKey&&returnContextValid(batchReturn)){
      var saved=batchReturn;batchReturn=null;pieceEditorOpen=false;piecesView=false;
      var panels=M.layout(state.params).panels.filter(function(piece){return saved.roles.indexOf(piece.role)>=0;});
      if(panels.length===saved.roles.length){openDivisionBatch(panels);restoreBatchFields(saved);restoreNavigationScroll(saved.scroll);return;}
    }
    batchReturn=null;
    if(selectionPayload.selection_return){request('back_to_selection',[]);return;}
    pieceEditorOpen=false;updateChrome();
    window.setTimeout(function(){document.querySelector('main').scrollTop=piecesScrollTop||0;},0);
  }
  function readForm() {
    var raw = M.clone(state.params);
    function setMaterial(role,material){
      var data=raw.piece_settings[role];if(!data||data.construction_type==='glass')return;
      var previous=data.material;data.material=material;
      Object.keys(data.edge_materials||{}).forEach(function(edge){if(data.edge_materials[edge]===previous)data.edge_materials[edge]=material;});
    }
    raw.name = $('name').value; raw.back = $('back').checked;raw.joint_banding=$('joint_banding').checked;
    raw.fronts.forEach(function(front){if(front.kind==='drawers'&&front.id!==state.editingFront)front.rear_clearance=Math.max(10,front.rear_clearance||10);});
    dimensionKeys.forEach(function (key) { raw[key] = $(key).value; });
    constructionKeys.forEach(function (key) { raw[key] = $(key).value; });
    if(raw.module_family==='panel'){
      raw.thickness=$('panel-thickness').value;raw.material=$('panel-main-material').value;
      document.querySelectorAll('[data-panel-field]').forEach(function(control){raw.panel[control.dataset.panelField]=control.type==='checkbox'?control.checked:control.value;});
      raw.panel.mirror=raw.panel.surface==='mirror'?raw.panel.mirror:'none';
      [['rib_material',/:slat:\d+$/],['base_material',/:base$/]].forEach(function(layer){
        if(raw.panel[layer[0]]!==state.params.panel[layer[0]]||materialEditedFields['panel-'+layer[0].replace('_','-')])Object.keys(raw.piece_settings).forEach(function(role){if(layer[1].test(role))setMaterial(role,raw.panel[layer[0]]);});
      });
      Object.keys(raw.piece_settings).filter(function(role){return /^panel:r\d+:c\d+:face$/.test(role);}).forEach(function(role){
        if(Number(raw.thickness)!==state.params.thickness)raw.piece_settings[role].thickness=Number(raw.thickness);
        if(raw.material!==state.params.material||materialEditedFields['panel-main-material'])setMaterial(role,raw.material);
      });
      if(raw.material!==state.params.material||materialEditedFields['panel-main-material'])Object.keys(raw.piece_settings).forEach(function(role){if(/:channel:(?:start:closure|finish:(?:left|right))$/.test(role))setMaterial(role,raw.material);});
      if(!window.MyDinaPanel.fitsSingle({width:M.number(raw.width,'Largura',1,1e9),height:M.number(raw.height,'Altura',1,1e9),panel:raw.panel}))raw.panel.continuous=true;
    }else if(raw.module_family==='cabinet'){
      if(raw.material!==state.params.material||materialEditedFields.material)Object.keys(raw.piece_settings).forEach(function(role){if(/^(left|right|bottom|top|rail:front|rail:back|bottom:front|bottom:back|back:top|back:bottom)$/.test(role)||role.indexOf('split:')===0)setMaterial(role,raw.material);});
      if(raw.back_material!==state.params.back_material||materialEditedFields.back_material)setMaterial('back',raw.back_material);
    }
    return M.normalize(raw,state.params);
  }
  function fillForm(p) {
    state.params = M.normalize(p);
    p = state.params;
    $('name').value = p.name;
    dimensionKeys.forEach(function (key) { setValue(key,measureText(p[key])); });
    $('back').checked = p.back; $('back_thickness').disabled = !p.back;
    $('joint_banding').checked=!!p.joint_banding;
    constructionKeys.forEach(function (key) { $(key).value = p[key]; });
    if(p.module_family==='panel'){
      setValue('panel-thickness',p.thickness);$('panel-main-material').value=p.material;
      document.querySelectorAll('[data-panel-field]').forEach(function(control){var value=p.panel[control.dataset.panelField];if(control.dataset.panelField==='mirror'&&value==='none')value='full';if(control.type==='checkbox')control.checked=value;else if(control.id)setValue(control.id,value);else control.value=value;});
      if(p.panel.mirror!=='none')$('panel-surface').value='mirror';
      applyThicknessOptions();
    }
    constructionVisibility();
    if(!state.editingFront)setValue('front-thickness',p.thickness);
    refreshMaterialButtons();
    renderPreview();renderCustomMaterials();
  }
  function moduleCapabilities(){
    if(state.moduleDescriptor&&String(state.moduleDescriptor.target_id)===String(state.target)&&state.moduleDescriptor.family===state.params.module_family)return state.moduleDescriptor.capabilities;
    return state.params.module_family!=='cabinet'?
      {openings:false,construction:false,pieces:true,materials:true,hardware:false}:
      {openings:true,construction:true,pieces:true,materials:true,hardware:false};
  }
  function selectionCapabilities(){
    return selectionPayload.selection_capabilities||{
      navigation:['bulk','pieces','mixed','volume'].indexOf(selectionKind)>=0,
      general:['bulk','pieces','mixed','volume'].indexOf(selectionKind)>=0,
      materials:!!(selectionPayload.targets||[]).length,pieces:!!volumeContext,
      insertions:!!volumeContext
    };
  }
  function constructionTabLabel(){
    return 'Peças e materiais';
  }
  function receiveModuleContext(payload,selection){
    var reset=selection||payload.ready||payload.target_id&&String(payload.target_id)!==String(state.target);
    if(reset||payload.module_descriptor!==undefined)state.moduleDescriptor=payload.module_descriptor||null;
    if(reset||payload.module_children!==undefined)state.moduleChildren=payload.module_children||payload.carcasses||[];
    if(reset||payload.module_inventory!==undefined)state.moduleInventory=payload.module_inventory||null;
  }
  function panelWallDistanceInvalid(){
    if(state.params.module_family!=='panel'||$('panel-fixation').value!=='channel')return false;
    var text=$('panel-wall-distance').value.trim().replace(',','.');
    return text!==''&&isFinite(Number(text))&&Number(text)<30;
  }
  function panelVisibility(){
    var panel=state.params.module_family==='panel';
    $('panel-controls').hidden=!panel;
    $('depth').closest('.field').hidden=panel;
    var invalidDistance=panelWallDistanceInvalid();
    $('panel-wall-distance-warning').hidden=!invalidDistance;
    $('panel-wall-distance').setAttribute('aria-invalid',invalidDistance?'true':'false');
    if(!panel)return;
    var surface=$('panel-surface').value,mirror=$('panel-mirror').value;
    $('panel-surface-material').hidden=surface==='ribbed';
    $('panel-thickness-field').hidden=surface==='ribbed';
    $('panel-material-label').textContent=surface==='mirror'?'Material principal da base':'Material do painel';
    $('panel-thickness-label').textContent=surface==='mirror'?'Espessura da base do espelho (mm)':'Espessura do painel (mm)';
    $('panel-mirror-base-material-field').hidden=$('panel-mirror-retalho').checked;
    $('panel-mirror-base-inherit').hidden=$('panel-mirror-retalho').checked||!$('panel-mirror-base-material').value;
    $('panel-rib-section').hidden=$('panel-rib-fields').hidden=surface!=='ribbed';
    $('panel-base-toggle').hidden=surface!=='ribbed';
    $('panel-base-fields').hidden=surface!=='ribbed'||!$('panel-base').checked;
    $('panel-feet-field').hidden=surface==='ribbed'&&!$('panel-base').checked;
    $('panel-feet-settings').hidden=!$('panel-feet').checked;
    var horizontal=document.querySelector('[data-panel-field="rib_direction"]').value==='horizontal';
    $('panel-tape-bottom-label').textContent=horizontal?'Fitar ponta esquerda das réguas':'Fitar base das réguas';
    $('panel-tape-top-label').textContent=horizontal?'Fitar ponta direita das réguas':'Fitar topo das réguas';
    $('panel-groove-fields').hidden=surface!=='grooved';$('panel-mirror-section').hidden=surface!=='mirror';$('panel-mirror-fields').hidden=surface!=='mirror';
    $('panel-mirror-insets').hidden=mirror!=='inset';$('panel-channel-fields').hidden=$('panel-fixation').value!=='channel';
    var reverse=$('panel-installation-direction').value==='right_to_left',compact=Number($('panel-wall-distance').value.replace(',','.'))===30;
    $('panel-installation-hint').textContent='Instale o conjunto inicial de '+(compact?'duas':'três')+' peças na parede. Encaixe cada painel pela '+(reverse?'direita':'esquerda')+' e parafuse na parede pela '+(reverse?'esquerda':'direita')+'.';
    $('panel-joint-hint').textContent='Nas emendas: Fix painel de 60 mm e Fix parede de '+(compact?'100':'60')+' mm. Desconto no encontro de 20 mm. Avanço da Trava de 15 mm, com folga de 5 mm.';
    if(['continuation','final'].indexOf($('panel-installation-position').value)>=0)$('panel-installation-hint').textContent='Encaixe no painel anterior pela '+(reverse?'direita':'esquerda')+'.'+($('panel-installation-position').value==='continuation'?' Parafuse na parede pela '+(reverse?'esquerda':'direita')+'.':'');
    if($('panel-installation-position').value==='isolated')$('panel-installation-hint').textContent='Instale o conjunto inicial de '+(compact?'duas':'três')+' peças na parede. Os painéis com continuação são parafusados pela '+(reverse?'esquerda':'direita')+'.';
    if($('panel-installation-position').value==='final')$('panel-installation-hint').textContent='Encaixe o último painel pela '+(reverse?'direita':'esquerda')+' e apoie a outra extremidade no conjunto final.';
    $('panel-final-warning').hidden=['final','isolated'].indexOf($('panel-installation-position').value)<0;
    $('panel-final-warning').textContent='Instale o conjunto final na parede antes do último painel. Apoio painel de 60 mm, recuado 15 mm da borda.';
    $('detach-panel-units').disabled=state.busy||state.dirty||!state.target||!!state.conflict;
    try{
      var draft=readForm(),locked=!window.MyDinaPanel.fitsSingle(draft);
      if(locked)$('panel-continuous').checked=true;
      $('panel-continuous').disabled=state.busy||locked;
      $('panel-continuous-label').classList.toggle('continuous-locked',locked);
      $('panel-continuous-warning').hidden=!locked;
    }catch(error){$('panel-continuous-warning').hidden=true;}
    $('panel-gap-field').hidden=$('panel-composition-summary').hidden=!$('panel-continuous').checked;
    if($('panel-continuous').checked){
      try{var grid=window.MyDinaPanel.grid(readForm());$('panel-composition-summary').textContent=U.count(grid.columns*grid.rows,'painel físico','painéis físicos')+' · '+U.count(grid.columns,'coluna','colunas')+' × '+U.count(grid.rows,'linha','linhas');}
      catch(error){$('panel-composition-summary').textContent='Ajuste as medidas para calcular a divisão.';}
    }
  }
  $('panel-mirror-base-inherit').addEventListener('click',function(){$('panel-mirror-base-material').value='';changed();refreshMaterialButtons();});
  function renderCustomMaterials(){
    var list=$('custom-materials');list.textContent='';
    if(moduleCapabilities().summary){
      var inventory=state.moduleInventory,title=document.createElement('h3'),scope=document.createElement('p');
      title.textContent='Inventário do conjunto';list.appendChild(title);scope.className='hint';list.appendChild(scope);
      if(!inventory){scope.textContent='Inventário ainda não disponível.';return;}
      scope.textContent=inventory.total+' peças · '+inventory.mdf_count+' em MDF. Chapas dos módulos internos e peças diretas; ferragens não entram nesta contagem.';
      var labels={mdf:'MDF',glass:'Vidro',metal:'Metal'};
      (inventory.materials||[]).forEach(function(group){
        var row=document.createElement('div'),label=document.createElement('span'),count=document.createElement('span');row.className='part-row';
        label.textContent=(labels[group.family]||group.family)+' · '+group.material;count.textContent=group.count+' '+(group.count===1?'peça':'peças');
        row.appendChild(label);row.appendChild(count);list.appendChild(row);
        var owners=document.createElement('p');owners.className='hint';owners.textContent=(group.owners||[]).map(function(owner){return owner.name;}).filter(Boolean).join(' · ');list.appendChild(owners);
      });
      if(!inventory.complete){var warning=document.createElement('p');warning.className='hint';warning.textContent='Inventário parcial: '+U.count(inventory.issues.length,'peça precisa de conferência.','peças precisam de conferência.');list.appendChild(warning);}
      if(inventory.complete&&!inventory.total){var empty=document.createElement('p');empty.className='hint';empty.textContent='Nenhuma peça física encontrada neste conjunto.';list.appendChild(empty);}
      var hint=document.createElement('p');hint.className='hint';hint.textContent='Resumo para consulta. Edite materiais e configurações no módulo correspondente.';list.appendChild(hint);
      if(!(state.moduleMaterials||[]).length)return;
      var directTitle=document.createElement('h3');directTitle.textContent='Peças diretas';list.appendChild(directTitle);
      var directHint=document.createElement('p');directHint.className='hint';directHint.textContent='Os controles abaixo alteram somente as peças diretas deste conjunto.';list.appendChild(directHint);
    }
    (state.moduleMaterials||[]).forEach(function(group){
      var row=document.createElement('div'),swatch=document.createElement('span'),label=document.createElement('span'),count=document.createElement('span'),arrow=document.createElement('span'),button=document.createElement('button');
      var entry=catalog.filter(function(item){return item.id===group.catalog_id;})[0]||catalogEntryForValue(group.name);
      var title=[group.name,group.brand,group.line].filter(Boolean).join(' · ');
      row.className='part-row custom-material-row';swatch.className='material-swatch';paintSwatch(swatch,entry);swatch.setAttribute('aria-hidden','true');
      label.className='material-name';label.textContent=title;label.title=title;arrow.className='material-arrow';arrow.textContent='▾';
      count.className='custom-material-count';count.textContent=group.parts.length+' '+(group.parts.length===1?'peça':'peças');
      button.type='button';button.className='material-choice';button.title='Trocar '+title+' somente neste módulo';button.setAttribute('aria-label',button.title);
      button.addEventListener('click',function(){
        if(!state.target||state.dirty||state.busy)return;
        materialGroup={key:group.key,parts:group.parts.slice(),selectionKey:selectionKey,target:state.target};
        switchTab('materials');
      });
      button.disabled=state.busy||state.dirty;button.appendChild(swatch);button.appendChild(label);button.appendChild(arrow);row.appendChild(button);row.appendChild(count);list.appendChild(row);
    });
    if(!list.childNodes.length){var empty=document.createElement('p');empty.className='hint';empty.textContent='Nenhuma peça MDF diretamente neste módulo.';list.appendChild(empty);}
    if((state.moduleChildren||[]).length){var directScope=document.createElement('p');directScope.className='hint';directScope.textContent='Esta lista mostra peças diretas. Módulos internos mantêm seus próprios materiais.';list.appendChild(directScope);}
  }
  function draw(svg, params, interactive) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var info = M.layout(params);
    var scale = Math.min(295/params.width,185/params.height);
    var w = params.width*scale, h = params.height*scale, ox = (400-w)/2, oy = (245-h)/2;
    info.openings.forEach(function (opening, index) {
      var x = ox+opening.x*scale, y = oy+(params.height-opening.z-opening.height)*scale;
      var attrs = { x:x,y:y,width:opening.width*scale,height:opening.height*scale,
        fill:params.back?'#e4e2d6':'#f3f2eb',stroke:'#cccdbc','stroke-width':0.6 };
      if (interactive) {
        attrs['class'] = 'opening' + (state.selected===opening.id?' selected':'');
        attrs.tabindex = '0'; attrs.role = 'button';
        attrs['aria-label'] = 'Vão '+(index+1)+', '+format(opening.width)+' por '+format(opening.height)+' milímetros';
        attrs['aria-pressed'] = String(state.selected===opening.id); attrs['data-opening'] = opening.id;
      }
      var rect = el('rect',attrs);
      if (interactive) {
        rect.addEventListener('click',function () { chooseOpening(opening.id); });
        rect.addEventListener('keydown',function (event) {
          if (event.key==='Enter' || event.key===' ') { event.preventDefault(); chooseOpening(opening.id); }
        });
      }
      svg.appendChild(rect);
      if (opening.width*scale > 34 && opening.height*scale > 24) {
        svg.appendChild(el('text',{x:x+opening.width*scale/2,y:y+opening.height*scale/2+4,'text-anchor':'middle','class':'svg-label'},'V'+(index+1)));
      }
    });
    info.boards.forEach(function (b) {
      var board=el('rect',{x:ox+b.x*scale,y:oy+(params.height-b.z-b.h)*scale,width:b.w*scale,height:b.h*scale,
        fill:state.pieceRole===b.role?'#d1ad68':'#d6c19e',stroke:'#aa936f','stroke-width':.6,'class':interactive&&b.role.indexOf('split:')===0?'movable-board':'','data-piece':b.role});
      svg.appendChild(board);
      if(interactive){board.addEventListener('click',function(){if(b.role.indexOf('split:')===0)openDivision(b.role.slice(6),false);else{state.pieceRole=b.role;renderPreview();}});
        if(b.role.indexOf('split:')===0)board.addEventListener('pointerdown',function(event){startPreviewDrag(event,b,scale,ox,oy);});}
    });
    info.panels.filter(function (b) { return b.role.indexOf('front:')===0 && (b.role.indexOf(':face')>0 || /^front:[^:]+:\d+$/.test(b.role)); }).forEach(function (b) {
      svg.appendChild(el('rect',{x:ox+b.origin[0]*scale,y:oy+(params.height-b.origin[2]-b.size[2])*scale,width:b.size[0]*scale,height:b.size[2]*scale,
        fill:'#75957e','fill-opacity':.28,stroke:'#456f57','stroke-width':1,'pointer-events':'none'}));
    });
    svg.appendChild(el('text',{x:ox+w/2,y:oy+h+18,'text-anchor':'middle','class':'svg-dim'},format(params.width)+' mm'));
    svg.appendChild(el('text',{x:ox+w+13,y:oy+h/2,transform:'rotate(-90 '+(ox+w+13)+' '+(oy+h/2)+')','text-anchor':'middle','class':'svg-dim'},format(params.height)+' mm'));
    return info;
  }
  function format(n) { return Number(n).toLocaleString('pt-BR',{maximumFractionDigits:userSettings.precision}); }
  function renderPreview() {
    var info = M.layout(state.params);
    if (!info.openings.some(function (o) { return o.id===state.selected; })) state.selected=info.openings.length?info.openings[0].id:'root';
    draw($('preview'),state.params,true);
    var selected = info.openings.filter(function (o) { return o.id===state.selected; })[0];
    var index = info.openings.indexOf(selected)+1;
    selected=selected||{width:state.params.width,height:state.params.height};
    $('add-shelf').disabled=$('add-divider').disabled=!!state.params.assembly;
    $('add-front').disabled=!!state.params.assembly;
    $('mdf-settings').hidden=!!state.params.assembly; $('construction-geometry').hidden=!!state.params.assembly;
    $('opening-count').textContent = info.openings.length+' '+(info.openings.length===1?'vão':'vãos');
    $('opening-info').textContent = 'Vão '+index+' · '+format(selected.width)+' × '+format(selected.height)+' mm livres';
    $('construction-summary').textContent='MDF '+format(state.params.thickness)+' mm · '+(state.params.back?(state.params.back_panel_type==='rails'?'Réguas do fundo '+format(state.params.thickness):'Fundo '+format(state.params.back_thickness))+' mm':'Sem fundo');
    renderFronts(info);renderPieces();renderCladdings();renderTrims();renderAccessories();renderDivisions(info);
    if(flow.openings.length){
      // An acknowledged Apply may split its own original destination. That
      // destination still belongs to this session until Conclude/Cancel. An
      // external revision invalidates the session before reaching this code.
      var openingBase=insertSessionActive()&&flow.creation.applied?flow.creation.baseParams:state.params;
      var windows=M.windows(openingBase,flow.tool!=='shelf'&&flow.tool!=='divider'),valid=flow.openings.filter(function(item){return windows.some(function(w){return w.id===item.id;});});
      flow.openings=valid;flow.opening=valid[0]||null;
      if(flow.opening){
        state.selected=flow.opening.id;
        var active=windows.find(function(w){return w.id===flow.opening.id;});
        if(valid.length===1&&active){
          $('selected-opening-title').textContent='Vão selecionado · '+(flow.opening.side==='rear'?'trás':'frente');
          $('selected-opening-measures').textContent=format(active.width)+' × '+format(active.height)+' × '+format(active.depth)+' mm';
        }else{
          var sides=valid.map(function(item){return item.side;}).filter(function(value,index,array){return array.indexOf(value)===index;});
          $('selected-opening-title').textContent=valid.length+' vãos selecionados';
          $('selected-opening-measures').textContent=(sides.length===1?(sides[0]==='rear'?'Trás':'Frente'):'Frente e trás')+' · a ação rápida será aplicada em todos';
        }
      }
    }else flow.opening=null;
  }
  function updateChrome() {
    bindEditorContext();
    ['width','height','depth'].forEach(function(key){var control=$(key),composite=!!state.params.assembly&&!!(state.moduleChildren||state.carcasses||[]).length;control.disabled=composite;control.title=composite?'Escolha o módulo em Inserções para alterar suas medidas.':'';});
    $('open-central-saved').disabled=state.busy||centralSetupStep==='preparing';
    $('mode').textContent = standaloneTrim?'Rodapé avulso':selectionKind==='piece_group'?'Peças avulsas':state.moduleDescriptor&&state.moduleDescriptor.role==='group'?'Grupo selecionado':['bulk','pieces','mixed'].indexOf(selectionKind)>=0?'Edição em conjunto':selectionKind==='piece'?'Peça selecionada':state.target?(state.moduleDescriptor&&state.moduleDescriptor.label||'Seleção atual'):'Selecione no projeto';
    var moduleSelected=selectionKind==='module',insertMode=insertSessionActive(),capabilities=moduleCapabilities(),custom=!capabilities.construction;
    var panelFamily=state.params.module_family==='panel';
    selectionSteps[1].label=constructionTabLabel();
    var materialTab=selectionStepButton('construction-settings');if(materialTab)materialTab.textContent=selectionSteps[1].label;
    $('construction-title').textContent=selectionSteps[1].label;
    $('construction-summary').hidden=custom;
    $('cabinet-construction').hidden=custom;$('custom-materials').hidden=!custom||panelFamily;
    panelVisibility();
    var focusedEditor=!flow.componentEditing&&(insertMode||!!state.editingFront||!!divisionEdit||!!divisionBatch||!!editingCladding||!!editingTrim||!!editingAccessory||!!standaloneTrim);
    document.body.classList.toggle('insert-session',focusedEditor);
    $('module-editor').hidden=!moduleSelected||piecesView;
    var openingActive=moduleSelected&&focusedEditor&&!piecesView;
    ['general-settings','construction-settings'].forEach(function(id){$(id).hidden=openingActive;});
    $('selected-opening').hidden=true;
    updateSelectionStepAvailability(openingActive);
    if(openingActive){$('mode').textContent=insertMode?'Inserindo '+insertToolLabels[flow.creation.kind].toLowerCase():'Editando inserção';}
    $('select-openings').disabled=state.busy||state.dirty||!capabilities.openings;
    ['choose-door','choose-drawer','choose-spice','add-shelf','add-divider','add-cladding-tool','add-baseboard','add-crown','add-accessory','config-door','config-drawer','config-shelf','config-divider','add-front','apply-division','remove-split','add-cladding','save-trim','save-accessory'].forEach(function(id){if($(id))$(id).disabled=state.busy||!state.target||!!state.conflict||!!state.params.assembly&&!(custom&&(id==='add-accessory'||id==='save-accessory'));});
    if(standaloneTrim)$('save-trim').disabled=state.busy;
    if(insertMode&&(flow.creation.kind==='door'||flow.creation.kind==='drawers'||flow.creation.kind==='shelf'||flow.creation.kind==='divider')){
      $('add-front').disabled=$('apply-division').disabled=state.busy||openingTargets().length===0;
    }
    var actions=document.querySelector('.insert-actions');
    if(actions){actions.hidden=focusedEditor;Array.prototype.forEach.call(actions.children,function(tool){tool.hidden=custom&&!tool.querySelector('#add-accessory');});}
    if($('insert-tool-hint'))$('insert-tool-hint').hidden=focusedEditor||!capabilities.openings;
    ['front-list','division-list','cladding-list','trim-list','accessory-list'].forEach(function(id){if($(id))$(id).hidden=focusedEditor||(custom&&id!=='accessory-list'&&!(id==='trim-list'&&state.params.module_family==='baseboard'));});
    if($('insertions-history'))$('insertions-history').hidden=focusedEditor;
    if($('contextual-insertions'))$('contextual-insertions').hidden=focusedEditor;
    setActiveInsertTool(flow.tool);
    updateInsertTargetCount();
    document.querySelectorAll('#front-list button,#division-list button,#cladding-list button,#trim-list button,#accessory-list button').forEach(function(button){button.disabled=state.busy;});
    $('empty-selection').hidden=selectionKind!=='empty';
    $('bulk-selection').hidden=['bulk','pieces','mixed'].indexOf(selectionKind)<0;
    $('solo-piece').hidden=selectionKind!=='piece';
    $('group-piece-list').hidden=selectionKind!=='piece_group';
    $('assemble-selection').hidden=!selectionPayload.can_combine;
    $('assemble-pieces').textContent=selectionPayload.module_count===1?'Incluir peças no módulo':selectionPayload.module_count>1?'Unir módulos':'Criar módulo com as peças';
    $('mixed-selection').hidden=true;
    ['refresh-project-finishes','assemble-pieces'].forEach(function(id){if($(id))$(id).disabled=state.busy;});
    refreshCatalogActions();
    refreshMaterialButtons();

    var tab=document.querySelector('.tab.active'),mainTabs=document.querySelector('.tabs'),selectionTabs=$('selection-step-tabs');
    var settingsVisible=!$('tab-settings').hidden;
    $('settings-footer').hidden=!settingsVisible;
    $('settings-save').disabled=state.busy;
    var moduleTab=!settingsVisible&&(!tab||tab.dataset.tab==='module');
    var pieceActionVisible=moduleTab&&(selectionKind==='piece'||moduleSelected&&piecesView&&pieceEditorOpen);
    $('back-to-pieces').textContent=batchReturn?'← Voltar ao lote':selectionPayload.selection_return?'← Voltar à seleção':'← Voltar para peças do módulo';
    var catalogPicker=!moduleTab&&(!!materialDestination||!!materialGroup);
    if(mainTabs)mainTabs.hidden=settingsVisible||moduleSelected&&focusedEditor||catalogPicker||!!standaloneTrim||pieceActionVisible;
    if($('catalog-picker-back')){$('catalog-picker-back').hidden=!catalogPicker||catalogFavoritesView;$('catalog-picker-back').disabled=state.busy;}
    if(selectionTabs)selectionTabs.hidden=!moduleSelected||focusedEditor||pieceActionVisible;
    $('module-footer').hidden=pieceActionVisible||focusedEditor||activeSelectionStep==='front-details'||!moduleSelected||!moduleTab;
    $('piece-footer').hidden=!pieceActionVisible;
    $('front-footer').hidden=!moduleTab||!moduleSelected||$('front-editor').hidden;
    $('division-footer').hidden=!moduleTab||!moduleSelected||$('division-editor').hidden;
    $('batch-footer').hidden=!moduleTab||!moduleSelected||!divisionBatch;
    ['apply-batch','remove-batch','cancel-batch'].forEach(function(id){$(id).disabled=state.busy;});
    $('cladding-footer').hidden=!moduleTab||!moduleSelected||$('cladding-editor').hidden;
    $('trim-footer').hidden=standaloneTrim?(!tab||tab.dataset.tab!=='library'||$('trim-editor').hidden):(!moduleTab||!moduleSelected||$('trim-editor').hidden);
    $('accessory-footer').hidden=!moduleTab||!moduleSelected||$('accessory-editor').hidden;
    var footer=document.querySelector('footer');if(footer){footer.classList.toggle('settings-mode',settingsVisible);footer.classList.toggle('piece-mode',pieceActionVisible);footer.classList.toggle('insert-mode',
      ['front-footer','division-footer','batch-footer','cladding-footer','trim-footer','accessory-footer'].some(function(id){return !$(id).hidden;}));}
    syncFooterStatus();
    if($('piece-footer-action'))$('piece-footer-action').disabled=state.busy;
    ['delete-piece','detach-piece','solo-delete-piece','solo-detach-piece','solo-back-to-pieces','back-to-pieces'].forEach(function(id){$(id).disabled=state.busy;});
    var solo=selectionPayload.pieces&&selectionPayload.pieces[0];
    $('solo-detach-piece').hidden=selectionKind!=='piece'||!solo||!solo.can_detach;
    if($('open-pieces')){$('open-pieces').hidden=true;$('open-pieces').disabled=true;}
    $('mode').className = 'pill'+(state.target?' edit':'');
    $('selection-label').textContent = state.target?state.params.name+(state.dirty?' · alterações pendentes':' · módulo carregado'):'Comece do zero ou carregue um módulo.';
    $('primary-action').textContent = 'Concluir';
    $('save-piece-library').disabled=state.busy||selectionKind!=='piece';
    var pieceActions=!!selectionPayload.include_count;
    var contextualPieces=!moduleSelected&&pieceActions;
    if($('pieces-workspace'))$('pieces-workspace').hidden=moduleSelected?!piecesView:!contextualPieces;
    $('pieces-category').hidden=!moduleSelected||focusedEditor||pieceEditorOpen;
    if($('module-piece-editor'))$('module-piece-editor').hidden=!(moduleSelected&&piecesView&&pieceEditorOpen);
    $('selection-piece-actions').hidden=!pieceActions||focusedEditor||pieceEditorOpen;
    $('register-selection').hidden=!selectionPayload.can_register||pieceActionVisible;
    $('register-pieces').disabled=state.busy||!selectionPayload.can_register;
    $('include-parts').hidden=!selectionPayload.include_count;
    $('include-parts').disabled=state.busy||!selectionPayload.include_count;
    $('save-model-behavior').disabled=state.busy||!modelConfig||!modelConfig.parts.length;
    $('primary-action').disabled = state.busy||!state.target||!!state.conflict||panelWallDistanceInvalid();
    $('save-library').disabled = !state.target || state.dirty || state.busy;
    $('save-library').title = !state.target?'Selecione um módulo para salvar.':state.dirty?'Conclua as alterações antes de salvar.':'Salvar módulo atual.';
    var productionReady=state.production&&!state.productionStale&&(!state.production.issues.length||!!state.partialApproval);
    var canProduce=productionReady&&state.production.rows.length;
    var hasMaterials=state.production&&state.production.materials&&Object.keys(state.production.materials).some(function(key){return key!=='notes'&&Array.isArray(state.production.materials[key])&&state.production.materials[key].length;});
    $('open-central').disabled=state.busy||centralSetupStep==='preparing'||!productionReady||(!canProduce&&!hasMaterials);
    $('open-material-list').disabled=state.busy||!hasMaterials;
    $('read-production').disabled=state.busy||operations.pending('read_production');
    document.querySelectorAll('input[name="production-scope"]').forEach(function(n){n.disabled=operations.pending('read_production');});
    $('optimize-cut').disabled=state.busy||!canProduce;
    $('export-cut').disabled=state.busy||!state.cutPlan||!!state.cutPlan.unplaced.length;
    $('edit-in-model').disabled=state.busy||!state.target||state.dirty||!M.layout(state.params).panels.some(function(p){return p.role.indexOf('split:')===0;});
    $('save-production').disabled=state.busy||!canProduce;
    $('improve-cut').disabled=state.busy||!state.cutPlan;
    $('cancel-cut').hidden=!state.searching;
    $('cut-progress').hidden=!state.searching;
    document.querySelectorAll('#tab-production input,#tab-production select,#add-offcut').forEach(function(control){control.disabled=state.busy||!!state.searching;});
    $('cut-next').disabled=state.busy||!canProduce;
    document.querySelectorAll('[data-cut-step]').forEach(function(button){var step=Number(button.dataset.cutStep);button.disabled=!!state.searching||(step===2&&!canProduce)||(step===3&&!state.cutPlan&&!state.searching);});
    refreshPins();syncVolumeChrome();if(editorPolicy)editorPolicy.sync();
    syncConfigurationVisibility();
    (tabRefreshers||[]).forEach(function(refresh){refresh();});
  }

  function setupVolumeControls(){
    var tab=$('tab-module'),nav=document.createElement('nav');nav.id='volume-tabs';nav.className='selection-step-tabs';nav.hidden=true;
    ['general','materials','insertions','pieces'].forEach(function(key,i){var b=document.createElement('button');b.type='button';b.className='selection-step-tab';b.dataset.volumeStep=key;b.textContent=['Geral','Peças e materiais','Inserções','Peças'][i];b.onclick=function(){volumeStep=key;updateChrome();};nav.appendChild(b);});tab.insertBefore(nav,$('bulk-selection'));
    var overview=document.createElement('section');overview.id='volume-general';overview.hidden=true;tab.insertBefore(overview,$('bulk-selection'));
    var insertions=document.createElement('section');insertions.id='volume-insertions';insertions.className='insert-actions';insertions.hidden=true;['baseboard','crown','cladding','door'].forEach(function(kind){var card=document.createElement('div');card.className='insert-tool';var b=document.createElement('button');b.type='button';b.className='insert-tool-main';b.textContent='+ '+insertToolLabels[kind];b.dataset.volumeKind=kind;b.onclick=function(){beginVolumeInsert(kind);};card.appendChild(b);insertions.appendChild(card);});tab.appendChild(insertions);
    var pieces=document.createElement('section');pieces.id='volume-pieces';pieces.hidden=true;tab.appendChild(pieces);
    var link=document.createElement('label');link.id='volume-link-control';link.className='checkbox-row';link.hidden=true;
    var checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.id='volume-link';checkbox.setAttribute('role','switch');var text=document.createElement('span');text.textContent='Vincular ao módulo';link.appendChild(checkbox);link.appendChild(text);tab.appendChild(link);
    checkbox.onchange=function(){if(!flow.volume)return;flow.volume.linked=checkbox.checked;refreshVolumeMode();if(flow.volume.kind==='door')requestVolumeOpenings();};
    var dimensions=document.createElement('div');dimensions.id='component-dimensions';dimensions.className='dimensions';dimensions.hidden=true;
    ['width','height','depth'].forEach(function(key,i){var label=document.createElement('label');label.className='field';label.textContent=['Largura (mm)','Altura (mm)','Profundidade (mm)'][i];var input=document.createElement('input');input.id='component-'+key;input.inputMode='decimal';label.appendChild(input);dimensions.appendChild(label);});tab.appendChild(dimensions);
  }
  function renderVolumeSelection(){
    var assemble=$('assemble-selection');
    if(!selectionCapabilities().navigation){$('bulk-selection').insertBefore(assemble,$('bulk-title').nextSibling);return;}
    var targets=selectionPayload.targets||[],box=$('volume-general');if(assemble.parentNode===box)$('bulk-selection').appendChild(assemble);box.textContent='';var title=document.createElement('h1');title.textContent=countText(targets.length,'item selecionado','itens selecionados');box.appendChild(title);
    if(volumeContext){var names=document.createElement('p');names.textContent=volumeContext.names.join(' · ');box.appendChild(names);var size=document.createElement('p');size.textContent='Volume externo · '+['width','height','depth'].map(function(k){return format(volumeContext[k]);}).join(' × ')+' mm (L × A × P)';box.appendChild(size);}
    else {var scope=document.createElement('p');scope.textContent='Seleção de módulos e peças. As ações respeitam os itens selecionados.';box.appendChild(scope);}
    box.appendChild(assemble);
    var selectedPieces=selectionPayload.selection_pieces||(volumeContext&&volumeContext.pieces)||[];
    var pieces=$('volume-pieces');pieces.textContent='';appendPieceHeading(pieces,'Peças da seleção',selectedPieces.length);
    selectedPieces.forEach(function(piece){var card=document.createElement('div');card.className='insert-tool';var b=document.createElement('button');b.type='button';b.className='insert-tool-main';b.textContent=(piece.name||'Peça')+(piece.module?' · '+piece.module:'');b.onclick=function(){request('open_piece',[piece.path]);};card.appendChild(b);pieces.appendChild(card);});
  }
  function beginVolumeInsert(kind,entry){
    if(state.busy||state.dirty||state.conflict)return;
    if(!userSettings.thicknesses.length){message('Adicione uma espessura de MDF em Configurações antes de inserir uma peça.','error');return;}
    if(activePaint)endPaintSession();clearInternalEditors();var gallery=!!entry,context=gallery?null:volumeContext;if(!gallery&&!context)return;
    var p=M.clone(gallery?entry.params:context.params);
    var volume={kind:kind,gallery:gallery,context:context,source:M.clone(state.params),linked:!gallery&&context.targets.length===1,originalTarget:state.target};
    // A single caixaria retains its existing recipe when the switch is on.
    volume.cabinet=!gallery&&selectionKind==='module'&&state.params.module_family==='cabinet';
    flow.start(kind,'create',{baseParams:p,volume:volume,selecting:kind==='door',owner:volume.cabinet&&volume.linked?'insertion':'volume'});flow.opening=null;flow.openings=[];setActiveInsertTool(kind);
    fillForm(p);$('volume-link').checked=flow.volume.linked;$('volume-link').disabled=gallery||context.targets.length>1;
    $('volume-link-control').title=!gallery&&context.targets.length>1?'Com vários módulos ou grupos, o componente é sempre avulso.':'Ligado: cria dentro do grupo. Desligado: cria na raiz do modelo usando esta seleção como referência.';
    if(gallery){var holder=$('library-component-editor');if(!holder){holder=document.createElement('section');holder.id='library-component-editor';$('tab-library').appendChild(holder);}holder.hidden=false;$('library-content').hidden=true;}
    refreshVolumeMode(true);if(kind==='door')requestVolumeOpenings();updateChrome();document.querySelector('main').scrollTop=0;
  }
  function openIndependentComponent(entry){beginVolumeInsert(entry.kind,entry);}
  function volumeEditorId(kind){return ['door','drawer'].indexOf(kind)>=0?'front-editor':kind==='cladding'?'cladding-editor':'trim-editor';}
  function refreshVolumeMode(initial){
    if(!flow.volume)return;var v=flow.volume,p=flow.creation.baseParams;
    if(v.cabinet&&v.linked)p=M.clone(v.source);
    else if(v.context){p=M.clone(v.context.params);p.volume_bound=v.linked;p.module_family=v.kind==='baseboard'&&!v.linked?'baseboard':'functional';p.component_kind=v.kind;if(['baseboard','crown'].indexOf(v.kind)>=0&&!v.linked)p.height=100;}
    flow.creation.baseParams=p;state.params=M.clone(p);
    if(initial){if(v.kind==='drawer'){chooseFront('drawers',true);var drawer=p.fronts[0]||{};$('drawer-depth').value=p.depth;$('drawer-height').value=p.height;$('loose-drawer-width').value=p.width;fillExtraFront(drawer);}else if(v.kind==='door'){chooseFront('door',true);if(v.gallery){var f=p.fronts[0];if(f){$('door-hinged-mode').value=f.count===2?'double':f.door_opening||'left';$('front-fit').value=f.fit;syncDoorControls();}}}else if(v.kind==='cladding'){openCladdingEditor(v.gallery?'all':null);}else openTrimEditor(v.kind,v.gallery?p.trims[0]:null,p);}
    if(v.kind==='baseboard'||v.kind==='crown'){$('trim-dimensions').hidden=v.linked;$('trim-recesses').hidden=!v.linked;$('trim-coverage').hidden=!v.linked||!M.hasSideCladdings(p);syncTrimSideSetbacks();}
    if(v.kind==='cladding'&&!initial&&!v.gallery)['left','right','top','bottom'].forEach(function(side){var control=$('cladding-'+side);control.disabled=v.linked&&p.claddings.some(function(c){return c.side===side;});if(control.disabled)control.checked=false;});
    var editor=$(volumeEditorId(v.kind));editor.insertBefore($('volume-link-control'),editor.firstChild);
    var showDims=!v.linked&&v.kind==='cladding';$('component-dimensions').hidden=!showDims;
    if(showDims){editor.insertBefore($('component-dimensions'),$('volume-link-control').nextSibling);['width','height','depth'].forEach(function(k){$('component-'+k).value=p[k];});}
    if(v.gallery)$('library-component-editor').appendChild(editor);
    updateChrome();
  }
  function requestVolumeOpenings(){
    var v=flow.volume;if(!v)return;
    var envelope=externalSliding();
    flow.openings=[];flow.opening=null;
    flow.current.doorTargetEnvelope=envelope;
    request('select_openings',['door',!(v.cabinet&&v.linked),v.context?v.context.targets:null,envelope]);
  }
  function externalSliding(){return $('front-kind').value==='door'&&$('door-type').value==='sliding'&&$('front-fit').value==='overlay';}
  function refreshDoorTargets(){
    if(!flow.creation||flow.creation.kind!=='door')return;
    var envelope=externalSliding();
    // Giro and Basculante use the same bay selection. Replacing the native
    // SketchUp tool here discards the chosen opening and can close the editor.
    if(flow.current.doorTargetEnvelope===envelope)return;
    if(flow.volume){requestVolumeOpenings();return;}
    flow.openings=[];flow.current.doorTargetEnvelope=envelope;
    request('select_openings',['door',false,null,envelope]);
  }
  function commitVolumeComponent(p){
    var v=flow.volume;if(!v)return;
    if(v.cabinet&&v.linked){internalPending=nativeMode;request('update_module',[p,state.target,M.number($('elevation').value,'Elevação',-100000,100000)]);return;}
    p.volume_bound=v.linked;
    var freePlacement=v.gallery&&v.kind!=='door';
    request(freePlacement?'insert_independent_component':'create_volume_component',freePlacement?[v.kind,p]:[v.kind,p,v.context?v.context.targets:[],v.linked]);
  }
  function finishVolumeSession(volume){
    var v=volume||flow.volume;if(!v)return;if(flow.current){flow.current.volume=null;flow.current.layout=null;}
    Object.keys(editorHomes).forEach(function(id){editorHomes[id].appendChild($(id));});
    $('volume-link-control').hidden=true;$('component-dimensions').hidden=true;
    if($('library-component-editor'))$('library-component-editor').hidden=true;$('library-content').hidden=false;
    if(!(v.cabinet&&v.linked))fillForm(v.source);state.target=v.originalTarget;
  }
  function componentKind(){return state.params.module_family==='baseboard'?'baseboard':state.params.module_family==='functional'?state.params.component_kind:null;}
  function syncComponentStep(id){
    if(flow.volume||selectionKind!=='module'||!componentKind())return;
    if(id==='construction-settings')openComponentConfiguration();else if(flow.componentEditing){clearInternalEditors();}
  }
  function openComponentConfiguration(){
    if(componentEditorOpening||flow.componentEditing)return;var kind=componentKind();if(!kind)return;
    componentEditorOpening=true;clearInternalEditors();
    var editor=$(volumeEditorId(kind));$('construction-settings').querySelector('.category-body').appendChild(editor);
    if(kind==='cladding')openCladdingEditor('all');else if(['door','drawer'].indexOf(kind)>=0){var f=state.params.fronts[0];if(f){var button=document.querySelector('#front-list [data-front="'+f.id+'"]');if(button)button.click();}}else openTrimEditor(kind,(state.params.trims||[]).find(function(t){return t.kind===kind;}));
    // open methods call updateChrome; the tab stays usable during component editing.
    if(flow.current)flow.current.layout='component';$('construction-settings').querySelector('.category-body').appendChild(editor);editor.hidden=false;componentEditorOpening=false;updateChrome();
  }
  function syncVolumeChrome(){
    if(!$('volume-tabs'))return;var caps=selectionCapabilities(),collective=caps.navigation,v=flow.volume,own=flow.componentEditing;
    $('volume-tabs').hidden=!collective||!!v;['general','insertions','pieces'].forEach(function(k){$('volume-'+k).hidden=!collective||!!v||volumeStep!==k;});
    if(collective){$('empty-selection').hidden=true;$('mixed-selection').hidden=true;$('pieces-workspace').hidden=true;$('bulk-selection').hidden=!!v||volumeStep!=='materials';document.querySelectorAll('[data-volume-step]').forEach(function(b){var key=b.dataset.volumeStep,available=!!caps[key];b.disabled=state.busy||!available;b.title=available?'':key==='insertions'?caps.insertion_reason||'Esta seleção não define um volume.':'Esta seleção não contém peças Plany elegíveis para esta ação.';b.classList.toggle('active',key===volumeStep);});}
    var eligible=!!volumeContext;
    if(eligible&&!v){document.querySelectorAll('.insert-actions > *').forEach(function(tool){if(tool.querySelector('#choose-door,#add-cladding-tool,#add-baseboard,#add-crown')){tool.hidden=false;tool.querySelectorAll('button').forEach(function(b){b.disabled=state.busy||state.dirty;});}});}
    if(selectionKind==='module'){var b=selectionStepButton('construction-settings');if(b)b.textContent=constructionTabLabel();}
    if(own){$('module-editor').hidden=false;$('construction-settings').hidden=false;$('custom-materials').hidden=true;document.body.classList.remove('insert-session');document.querySelector('.tabs').hidden=false;$('selection-step-tabs').hidden=false;selectionSteps.forEach(function(s){var b=selectionStepButton(s.id);if(b)b.disabled=false;});selectionStepButton('pieces-workspace').disabled=false;activateComponentPanel();$('module-footer').hidden=true;if(['door','drawer'].indexOf(componentKind())>=0)$('change-front-target').hidden=true;}
    if(v){$('volume-link-control').hidden=v.gallery;$('module-editor').hidden=v.gallery;['general-settings','construction-settings'].forEach(function(id){$(id).hidden=true;});$('front-details').classList.add('active-selection-step');document.querySelector('.tabs').hidden=true;$('selection-step-tabs').hidden=true;$('module-footer').hidden=true;$('bulk-selection').hidden=true;var id=volumeEditorId(v.kind);$(id).hidden=false;['add-front','add-cladding','save-trim'].forEach(function(key){$(key).disabled=state.busy||(v.kind==='door'&&openingTargets().length===0);});}
    if(v||own){var kind=v?v.kind:componentKind();['front-footer','cladding-footer','trim-footer'].forEach(function(id){$(id).hidden=id!==(['door','drawer'].indexOf(kind)>=0?'front-footer':kind==='cladding'?'cladding-footer':'trim-footer');});syncFooterStatus();}
  }
  function activateComponentPanel(){activeSelectionStep='construction-settings';selectionSteps.forEach(function(s){$(s.id).classList.toggle('active-selection-step',s.id===activeSelectionStep);var b=selectionStepButton(s.id);if(b){b.classList.toggle('active',s.id===activeSelectionStep);b.setAttribute('aria-selected',String(s.id===activeSelectionStep));}});}

  function operationOwner(action,args){
    if(action==='detach_panel_units')return 'module_edit';
    if(action==='update_module')return checkboxPending?'module_edit':pendingRemoval||undoRestorePending?'removal':pieceApplyPending==='module'?'piece_edit':internalPending||insertSessionActive()||editorContext?'insertion':'module_edit';
    if(action==='select_openings'||action==='clear_opening')return 'opening_selection';
    if(action==='create_volume_component'||action==='insert_independent_component')return 'volume';
    if(action==='apply_catalog_material'&&String((args||[])[2]).indexOf('paint_')===0||action==='set_material_paint_scope'||action==='set_material_grain_tool'||action==='stop_material_paint')return 'material_paint';
    if(/^(update_piece|update_module_piece|set_extra_data|set_piece_edge|delete_piece|detach_piece)$/.test(action))return 'piece_edit';
    return action;
  }
  function editorBusy(){return ['insertion','module_edit','removal','volume','piece_edit'].some(function(owner){return operations.pending(owner);});}
  Object.defineProperty(state,'busy',{get:editorBusy});
  function bindEditorContext(){
    var entity=divisionEdit?{kind:divisionEdit.axis==='horizontal'?'shelf':$('divider-mode').value==='batente'?'batente':'divider',id:divisionEdit.id}:state.editingFront?{kind:$('front-kind').value,id:state.editingFront}:editingTrim?{kind:editingTrim,id:editingTrim}:editingCladding?{kind:'cladding',id:editingCladding}:editingAccessory?{kind:'accessory',id:editingAccessory}:null;
    if(!entity&&divisionBatch)entity={kind:'batch',id:divisionBatch.roles.join('|')};
    if(entity&&!flow.current)flow.start(entity.kind,'edit',{entity:entity,baseParams:M.clone(state.params),originScroll:divisionBatch?divisionBatch.originScroll:document.querySelector('main').scrollTop});
    if(flow.current){if(entity)flow.current.entity=entity;editorContext=flow.current.contract;}
    else if(!editorContext&&(pieceEditorOpen||selectionKind==='piece'))editorContext={owner:'piece_edit',target_id:operations.target,target_revision:operations.revision};
  }
  function invalidateEditContext(){
    var wasOpen=!!(editorContext||flow.current||pieceEditorOpen);
    finishVolumeSession();flow.invalidate('external_target_or_revision');
    internalPending=false;pendingRemoval=null;undoRestorePending=false;
    flow.opening=null;flow.openings=[];
    clearInternalEditors();pieceEditorOpen=false;editorContext=null;cancelInsertTool();return wasOpen;
  }
  function validateEditContext(){
    var context=flow.current&&flow.current.contract||editorContext;
    if(flow.current&&!flow.valid()||context&&(String(context.target_id)!==String(operations.target)||context.target_revision!==operations.revision)){
      invalidateEditContext();throw new Error('O alvo mudou. Abra novamente a configuração atualizada.');
    }
  }
  var reloadTimeout=null,updateInProgress=false;
  var recoveryButton=document.createElement('button');recoveryButton.type='button';recoveryButton.className='text-button';recoveryButton.textContent='Conferir operação no SketchUp';recoveryButton.hidden=true;$('status').parentNode.appendChild(recoveryButton);
  function pendingRecoverable(){return Object.keys(operations.owners).map(function(owner){return operations.owners[owner];}).find(function(entry){return entry.pending&&['insertion','module_edit','removal','piece_edit','set_extra_data'].indexOf(entry.meta.owner)>=0;});}
  recoveryButton.addEventListener('click',function(){var pending=pendingRecoverable();if(pending)request('recover_operation',[pending.meta],true);else recoveryButton.hidden=true;});
  function request(action,args,quiet) {
    if(state.dirty&&['delete_piece','detach_piece','detach_panel_units'].indexOf(action)>=0){message('Conclua ou cancele a edição do módulo antes de gerenciar as peças.','error');return null;}
    var owner=operationOwner(action,args);
    // Hover is transient: a newer side or mouseleave must replace an in-flight
    // highlight instead of dropping the clear or blocking the next side.
    if(action==='highlight_edge')operations.cancel(owner);
    if(owner==='material_paint'&&action==='apply_catalog_material'&&flow.current){
      if(flow.current.pending){message('Aguarde a conclusão desta alteração antes de pintar.','error');return null;}
      clearInternalEditors();
    }
    if(operations.pending(owner)){message('Aguarde a conclusão desta ação antes de repetir.','error');return null;}
    if((action==='insert_library'||action==='insert_standalone_baseboard')&&!userSettings.thicknesses.length){message('Adicione uma espessura de MDF em Configurações antes de inserir uma peça.','error');return;}
    if (!nativeMode) {
      if (action==='list_library') { renderLibrary(demoLibrary()); return; }
      if (action==='insert_library') {
        var entry=demoLibrary().starters.filter(function (e) { return e.id===args[0]; })[0];
        if (entry) { resetTarget(); selectionKind='module'; fillForm(entry.params); switchTab('module'); updateChrome(); }
        message('Modelo carregado na prévia. A inserção no projeto funciona dentro do SketchUp.');
        return;
      }
      message('Esta ação funciona no SketchUp após instalar o Plany. Aqui você pode experimentar as medidas e os vãos.');
      return;
    }
    if(action==='insert_library'||action==='insert_piece_library'||action==='insert_standalone_baseboard'||action==='edit_divisions'){args=(args||[]).slice();args.push(panelSnapshot());}
    var target=['insertion','module_edit','removal','piece_edit','volume'].indexOf(owner)>=0||['select_openings','set_extra_data','set_rule','replace_module_material','bulk_update','include_parts','combine_selection','register_pieces','assemble_selection'].indexOf(action)>=0||action==='apply_catalog_material'&&owner!=='material_paint'?operations.target:null;
    var sessionId=flow.current&&['update_module','select_openings','create_volume_component','insert_independent_component'].indexOf(action)>=0?flow.current.contract.session_id:null;
    var op=operations.begin(owner,action,target,action==='clear_opening'||action==='stop_material_paint'?'cancelling':action==='select_openings'?'selecting':flow.current&&flow.current.pending?flow.state.toLowerCase():'applying',sessionId);
    if(action==='delete_piece'&&op)operations.owners[owner].removedRole=(args||[])[1]||'';
    if(editorPolicy)editorPolicy.requested(op,action);
    if(action==='read_production')productionFeedback('Carregando peças e materiais…');
    if(action==='select_openings')openingSessionId=op.session_id;
    if(action==='update_module')editRejection=null;
    if(flow.current&&(['update_module','create_volume_component','insert_independent_component','select_openings'].indexOf(action)>=0))flow.bind(op);
    if(pendingRemoval&&owner==='removal')pendingRemoval.operation_id=op.operation_id;
    if(internalPending&&['insertion','removal','volume'].indexOf(owner)>=0)internalPending=op.operation_id;
    if(undoRestorePending&&owner==='removal')undoRestorePending=op.operation_id;
    if(!quiet){updateChrome();message(action==='reload_plugin'?'Recarregando Plany…':action==='read_production'?'Carregando peças e materiais…':action==='save_library'?'Salvando na Biblioteca…':action==='list_library'?'Carregando Biblioteca…':'Processando…');}
    try {
      if(action==='reload_plugin'){
        window.clearTimeout(reloadTimeout);
        reloadTimeout=window.setTimeout(function(){
          reloadTimeout=null;
          if(!operations.pending(owner))return;
          operations.cancel(owner);updateChrome();
          message('A recarga não respondeu. Tente novamente pelo menu Extensões > Recarregar Plany.','error');
        },45000);
      }
      window.sketchup[action].apply(window.sketchup,(args||[]).concat([{plany_operation:op}]));
      if(['insertion','module_edit','removal','piece_edit','set_extra_data'].indexOf(owner)>=0)window.setTimeout(function(){if(operations.pending(owner)&&operations.owners[owner].meta.operation_id===op.operation_id){recoveryButton.hidden=false;message('O SketchUp ainda não confirmou esta alteração. Você pode conferir o estado da operação.');}},10000);
      return op;
    }
    catch (error) {
      if(['insertion','module_edit','removal','piece_edit','set_extra_data'].indexOf(owner)>=0){
        recoveryButton.hidden=false;updateChrome();message('A comunicação foi interrompida. Confira a operação no SketchUp antes de repetir.','error');return op;
      }
      operations.finish(op);
      flow.resolve(op,true);
      if(internalPending===op.operation_id)internalPending=false;
      if(pendingRemoval&&pendingRemoval.operation_id===op.operation_id)pendingRemoval=null;
      if(undoRestorePending===op.operation_id)undoRestorePending=false;
      if(owner==='reload_plugin'){window.clearTimeout(reloadTimeout);reloadTimeout=null;}
      updateChrome();message('Não foi possível comunicar com o SketchUp. Reabra o painel.','error');
    }
  }
  function resetTarget() { state.target=null; state.extras=[];state.moduleMaterials=[];state.moduleChildren=[];state.moduleDescriptor=null;state.moduleInventory=null; state.dirty=false; }
  function changed(event) {
    if(event&&event.target&&event.target.dataset.panelField==='rib_start'&&state.params.module_family==='panel')state.params.panel.rib_start_overhang=true;
    state.dirty=true; constructionVisibility();
    try { state.params=readForm(); renderPreview(); message(state.target?'Alterações pendentes. Clique em Concluir.':'Prévia atualizada.'); }
    catch (error) { message(error.message,'error'); }
    updateChrome();
  }
  function commitInternal(p,restoreExcluded,intent){
    validateEditContext();
    if(editorBusy())throw new Error('Aguarde a conclusão da alteração deste alvo.');
    if(!flow.volume&&(!state.target||state.conflict))throw new Error('Carregue o módulo atualizado antes de inserir ou editar.');
    p=M.normalize(p,state.params);var elevation=M.number($('elevation').value,'Elevação',-100000,100000);
    var volume=flow.volume;
    if(volume&&!(volume.cabinet&&volume.linked)){
      if(!$('component-dimensions').hidden)['width','height','depth'].forEach(function(k){p[k]=M.number($('component-'+k).value,k,1,10000);});
      intent='finish'; // Native creation hands a new occurrence to placement.
    }
    var prepared=flow.current?flow.prepare(intent||'finish'):null;
    if(prepared&&prepared.skip){finishVolumeSession(volume);closeCompletedSession();message('Edição concluída.','success');return;}
    if(flow.volume){commitVolumeComponent(p,intent||'finish');return;}
    internalPending=nativeMode;
    var op=request('update_module',[p,state.target,elevation,restoreExcluded===true]);
    if(!op&&flow.current&&flow.current.pending){flow.current.pending=null;flow.transition(prepared.previous);}
  }
  function closeCompletedSession(){
    var completed=flow.current||flow.last,origin=completed&&completed.originScroll;
    flow.opening=null;flow.openings=[];clearInternalEditors();cancelInsertTool();updateChrome();
    if(flow.last&&flow.last.layout==='component')activateSelectionStep('general-settings',false);
    if(commandInsertPending){commandInsertPending=false;if(nativeMode&&window.sketchup.resume_commands)request('resume_commands',[],true);}
    if(origin!==undefined&&completed.contract.target_id===operations.target)restoreNavigationScroll(origin);
  }
  function clearInternalEditors(preserveSession){
    editRejection=null;
    if(!preserveSession&&flow.current){finishVolumeSession();flow.dismiss('editor_closed');cancelInsertTool();}
    editorContext=null;
    if(standaloneTrim)restoreTrimEditorHome();
    Object.keys(editorHomes).forEach(function(id){editorHomes[id].appendChild($(id));});
    materialEditedFields={};
    divisionEdit=null;divisionBatch=null;state.editingFront=null;editingFrontNodes=null;frontTargetChanging=false;editingCladding=null;editingTrim=null;editingAccessory=null;
    ['division-editor','front-editor','cladding-editor','trim-editor','accessory-editor'].forEach(function(id){if($(id))$(id).hidden=true;});
    if($('plany-batch-editor'))$('plany-batch-editor').hidden=true;
    setActiveInsertTool(flow.tool);
  }
  function chooseOpening(id){
    if(state.busy)return;clearInternalEditors();state.selected=id;state.pieceRole='';renderPreview();updateChrome();
  }
  function divisionName(role,p){
    var pieces=M.layout(p||state.params).panels,selected=pieces.find(function(b){return b.role===role;});
    if(!selected)return 'Divisão';
    if(selected.settings&&selected.settings.name)return selected.settings.name;
    var peers=pieces.filter(function(b){return b.role.indexOf('split:')===0&&b.name===selected.name;});
    return selected.name+' '+(peers.indexOf(selected)+1);
  }
  function frontName(f){
    if(f.drawer_type==='spice')return 'Tempereiro · '+f.spice_levels+' '+(f.spice_levels===1?'nível':'níveis');
    if(f.kind==='door'){
      var type={hinged:'giro',lift:'basculante',sliding:'correr'}[f.door_type||'hinged'];
      return f.door_type==='lift'?(f.count===1?'1 porta basculante':f.count+' portas basculantes (legado)'):(f.count===1?'1 porta de '+type:f.count+' portas de '+type);
    }
    return f.count===1?(f.visibility==='internal'?'1 gaveta interna':'1 gaveta com frente'):
      f.count+' '+(f.visibility==='internal'?'gavetas internas':'gavetas com frente');
  }
  function frontDetail(f){
    if(f.kind==='door'){
      var detail=f.door_type==='hinged'?(f.door_opening==='double'?'Duas folhas':f.door_opening==='right'?'Direita':'Esquerda'):
        f.door_type==='lift'?((f.door_opening==='bottom'?'Inferior':'Superior')+' · '+(f.lift_system==='mechanical'?'articulador':'pistão a gás')+(f.count>1?' · '+f.count+' folhas legadas':'')):(f.count+' folhas');
      return detail+' · '+(f.fit==='overlay'?'Sobreposta':'Embutida')+' · '+f.material;
    }
    return (f.runner==='telescopic'?'Telescópica':f.runner==='concealed'?'Oculta':'Outra corrediça')+' · '+(f.visibility==='internal'?'Interna':'Aparente');
  }
  function divisionDetail(piece){
    var data=piece.settings||{},kind=piece.name==='Prateleira'?'shelf':'divider';
    var type=data.construction_type==='glass'?'Vidro '+glassColorLabel(data.glass_color):'MDF';
    var fixation={screw:'Parafusada',dowel:'Cavilhada',connector:'Conector',shelf_support:'Suporte de apoio',angle:'Cantoneira'}[data.fixation||'screw'];
    var detail=type+' '+format(piece.size[piece.thickness_axis])+' mm · '+fixation;
    if(data.front_recess)detail+=' · recuo '+format(data.front_recess)+' mm';
    if(kind==='shelf'&&data.led)detail+=' · LED '+({front:'frente',center:'centralizado',rear:'fundo'}[data.led_position||'front']);
    return detail;
  }
  function renderDivisions(info){
    var list=$('division-list');list.textContent='';
    var contextCount=0,contextual=$('contextual-insertions');
    if(!contextual){contextual=document.createElement('div');contextual.id='contextual-insertions';list.parentNode.insertBefore(contextual,list);}
    contextual.textContent='';
    function focusCarcass(item,focus){if(state.busy)return;request('focus_carcass',[item.target_id,focus]);}
    function contextRow(label,action){contextCount++;var row=document.createElement('div'),name=document.createElement('span'),button=document.createElement('button');row.className='internal-row';name.textContent=label;button.className='small-button';button.textContent='Editar';button.addEventListener('click',action);row.appendChild(name);row.appendChild(button);contextual.appendChild(row);}
    if(state.compositeRoot){var back=document.createElement('button');back.className='text-button';back.textContent='← Voltar ao conjunto';back.addEventListener('click',function(){focusCarcass({target_id:state.compositeRoot},{return_to_origin:true});});contextual.appendChild(back);}
    (state.moduleChildren||state.carcasses||[]).forEach(function(item,index){
      var family=item.family||item.params.module_family,cabinet=family==='cabinet';
      var familyLabel=item.descriptor&&item.descriptor.label||(cabinet?'Caixaria':family==='panel'?'Painel':family==='baseboard'?'Rodapé':family==='functional'?'Componente':'Módulo');
      var label=item.name&&item.name!==M.defaults.name?item.name:familyLabel+' '+String.fromCharCode(65+index);
      contextRow(label+' · '+(cabinet||family==='panel'?'Peças e materiais':'Materiais'),function(){focusCarcass(item,{insertion:['carcass']});});
      if(!cabinet)return;
      var recipe=item.params,seen={};
      M.layout(recipe).panels.forEach(function(piece){if(piece.role.indexOf('split:')!==0)return;var node=M.find(recipe,piece.role.slice(6)),batch=node.insertion_batch||node.id;if(seen[batch])return;seen[batch]=true;contextRow(label+' · '+(node.split==='horizontal'?'Prateleiras':'Divisórias'),function(){focusCarcass(item,{insertion:['split',batch]});});});
      [['fronts','front','Portas e gavetas'],['claddings','cladding','Tamponamentos'],['trims','trim','Acabamento'],['accessories','accessory','Acessório']].forEach(function(group){(recipe[group[0]]||[]).forEach(function(entry){contextRow(label+' · '+(entry.kind==='baseboard'?'Rodapé':entry.kind==='crown'?'Rodateto':group[2]),function(){focusCarcass(item,{insertion:[group[1],group[1]==='trim'?entry.kind:(entry.id||entry.kind)]});});});});
    });
    if(state.extras.length){var additions=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Peças adicionais · '+state.extras.length;additions.appendChild(summary);state.extras.forEach(function(piece){var row=document.createElement('div'),label=document.createElement('span'),edit=document.createElement('button'),remove=document.createElement('button');row.className='internal-row';label.textContent=piece.name;edit.textContent='Editar';edit.className='small-button';edit.addEventListener('click',function(){setPiecesView(true);openModulePieceEditor('extra:'+piece.id);});remove.textContent='Remover';remove.className='small-button danger';remove.addEventListener('click',function(){request('delete_piece',[state.target,'extra:'+piece.id]);});row.appendChild(label);row.appendChild(edit);row.appendChild(remove);additions.appendChild(row);});contextual.appendChild(additions);}
    var divisions=info.panels.filter(function(b){return b.role.indexOf('split:')===0;});
    var batches={},ordered=[];
    divisions.forEach(function(piece){
      var id=piece.role.slice(6),node=M.find(state.params,id),key=node&&node.insertion_batch||id;
      if(!batches[key]){batches[key]=[];ordered.push(key);}
      batches[key].push(piece);
    });
    var totalInsertions=(state.params.accessories||[]).length+contextCount+(state.extras.length?1:0);
    if(moduleCapabilities().construction)totalInsertions+=ordered.length+(state.params.fronts||[]).length+((state.params.claddings||[]).length?1:0)+(state.params.trims||[]).length;
    $('front-summary').textContent=totalInsertions?(totalInsertions+' '+(totalInsertions===1?'inserção':'inserções')):'';
    if($('insertions-history-count'))$('insertions-history-count').textContent='· '+totalInsertions;
    ordered.forEach(function(batch){
      var grouped=batches[batch],piece=grouped[0],multiple=grouped.length>1;
      var row=document.createElement('div'),text=document.createElement('span'),edit=document.createElement('button'),remove=document.createElement('button'),detail=document.createElement('small');
      row.className='internal-row'+(grouped.some(function(item){return state.pieceRole===item.role;})?' selected':'');
      text.textContent=multiple?grouped.length+' '+(piece.thickness_axis===2?'prateleiras':'divisórias'):divisionName(piece.role);
      detail.textContent=multiple?'Inseridas juntas · '+divisionDetail(piece):divisionDetail(piece);text.appendChild(detail);
      edit.className='small-button';edit.textContent='Editar';edit.setAttribute('aria-label','Editar '+(multiple?'conjunto de '+grouped.length+' peças':divisionName(piece.role)));edit.dataset.division=piece.role.slice(6);
      edit.addEventListener('click',function(){openDivisionBatch(grouped);});
      remove.className='small-button danger';remove.textContent='Remover';remove.setAttribute('aria-label','Remover '+divisionName(piece.role));
      remove.setAttribute('aria-label',multiple?'Remover conjunto de '+grouped.length+' peças':'Remover '+divisionName(piece.role));
      remove.addEventListener('click',function(){if(multiple)removeDivisionBatch(grouped);else removeInserted('division',piece.role.slice(6));});
      row.appendChild(text);row.appendChild(edit);row.appendChild(remove);list.appendChild(row);
    });
  }
  function openPendingDivision(kind){
    var axis=kind==='shelf'?'horizontal':'vertical',pref=insertionPref(kind);
    clearInternalEditors(true);divisionEdit={id:null,isNew:true,axis:axis,key:selectionKey,pending:true};
    $('division-title').textContent='Configurar '+(kind==='shelf'?'prateleira':'divisória');
    $('division-mode').value=pref.mode||'ratio';$('division-position').value=pref.position===undefined?50:pref.position;
    $('divider-mode').value=pref.divider_mode||'internal';$('batente-depth').value=pinNumber('divider','batente-depth',70);
    $('division-quantity').value=String(pref.quantity||1);$('division-type').value=pref.type||'mdf';$('division-proportions').checked=true;
    $('division-led').value=pref.led?'led':'none';$('division-led-position').value=pref.led_position||'front';
    $('division-front-recess').value=pref.front_recess===undefined?'0':pref.front_recess;
    $('division-glass-color').value=pref.glass_color||'clear';
    $('division-material').value=state.params.material;
    $('division-span-label').textContent=kind==='shelf'?'Largura da prateleira (mm)':'Altura da divisória (mm)';
    $('division-span').value='';$('division-span').placeholder='Automático conforme o vão selecionado';
    $('division-depth').value='';$('division-depth').placeholder='Automático conforme o vão selecionado';
    syncDivisionControls();setValue('division-thickness',pref.thickness||state.params.thickness);
    if(Array.prototype.some.call($('division-fixation').options,function(o){return o.value===String(pref.fixation||'screw');}))$('division-fixation').value=pref.fixation||'screw';
    $('division-measures').open=false;$('division-advanced').open=!!pref.led;$('apply-division').textContent='Concluir inserção';$('cancel-division').textContent='Cancelar inserção';
    $('remove-split').hidden=true;$('division-editor').hidden=false;divisionPositionLabel();syncDivisionControls();updateInsertTargetCount();updateChrome();
  }
  function openDivision(id,isNew,axis,keepTool){
    if(state.busy)return;
    if(!keepTool)cancelInsertTool();
    try{
      var source=readForm(),p=isNew?M.split(source,id,axis):source,node=M.find(p,id);
      if(isNew){id=M.divisionId(p,id);node=M.find(p,id);}
      var kind=node.split==='horizontal'?'shelf':'divider',pref=insertionPref(kind),role='split:'+id;
      if(isNew){
        var mode=pref.mode||'ratio',value=M.number(pref.position,mode==='ratio'?'Proporção (%)':'Posição',0,mode==='ratio'?100:4000);
        node.position_mode=mode;if(mode==='ratio')node.ratio=value/100;else node.distance=value;
        var initial=M.clone(p.piece_settings[role]||{});
        applyDivisionConstruction(initial,{divider_mode:pref.divider_mode,batente_depth:pref.batente_depth,thickness:pref.thickness||p.thickness,type:pref.type||'mdf',fixation:pref.fixation||'screw',material:p.material,front_recess:pref.front_recess||'0',glass_color:pref.glass_color||'clear',led:!!pref.led,led_position:pref.led_position||'front'},p,node.split);
        setNewDivisionFrontBand(initial,p,node.split);
        p.piece_settings[role]=initial;
      }
      var piece=M.layout(p).panels.find(function(b){return b.role===role;});
      if(!piece)throw new Error('Selecione uma prateleira ou divisória.');
      clearInternalEditors();divisionEdit={id:id,isNew:isNew,axis:node.split,key:selectionKey};state.pieceRole=piece.role;
      var settings=piece.settings||{},current=isNew?pref:{
        divider_mode:settings.divider_mode,batente_depth:settings.batente_depth,quantity:'1',type:settings.construction_type||'mdf',fixation:settings.fixation||'screw',material:settings.material||piece.material,
        front_recess:settings.front_recess||0,glass_color:settings.glass_color||'clear',
        led:!!settings.led,led_position:settings.led_position||'front',thickness:piece.size[piece.thickness_axis]
      };
      $('division-title').textContent=isNew?'Configurar '+(kind==='shelf'?'prateleira':'divisória'):divisionName(piece.role,p);
      $('division-mode').value=node.position_mode;$('division-position').value=node.position_mode==='ratio'?node.ratio*100:node.distance;
      $('division-quantity').value=String(current.quantity||1);
      $('division-proportions').checked=isNew||node.keep_divider_proportions===true;
      $('divider-mode').value=current.divider_mode||'internal';$('batente-depth').value=current.batente_depth||70;
      $('division-type').value=current.type||'mdf';
      $('division-led').value=current.led?'led':'none';$('division-led-position').value=current.led_position||'front';
      $('division-front-recess').value=current.front_recess===undefined?0:current.front_recess;
      $('division-glass-color').value=current.glass_color||'clear';
      $('division-material').value=(current.type||'mdf')==='mdf'?(isNew?p.material:current.material||p.material):p.material;
      $('division-span-label').textContent=kind==='shelf'?'Largura da prateleira (mm)':'Altura da divisória (mm)';
      if(isNew){
        $('division-span').value='';$('division-span').placeholder=format(piece.size[node.split==='horizontal'?0:2])+' mm · automático';
        $('division-depth').value='';$('division-depth').placeholder=format(piece.size[1])+' mm · automático';
      }else{
        $('division-span').value=piece.size[node.split==='horizontal'?0:2];$('division-depth').value=piece.size[1];
      }
      syncDivisionControls();
      setValue('division-thickness',current.thickness||piece.size[piece.thickness_axis]);
      if(Array.prototype.some.call($('division-fixation').options,function(o){return o.value===String(current.fixation||'screw');}))$('division-fixation').value=current.fixation||'screw';
      $('division-measures').open=false;$('division-advanced').open=!!current.led;
      $('apply-division').textContent=insertSessionActive()?'Concluir inserção':isNew?'Inserir no módulo':'Concluir edição';
      $('cancel-division').textContent=insertSessionActive()?'Cancelar inserção':'Fechar';
      $('remove-split').hidden=isNew;$('remove-split').textContent='Remover esta '+(kind==='shelf'?'prateleira':'divisória');
      $('division-editor').hidden=false;divisionPositionLabel();syncDivisionControls();updateInsertTargetCount();
      $(kind==='shelf'?'add-shelf':'add-divider').setAttribute('aria-pressed','true');
      renderPreview();updateChrome();
    }catch(error){message(error.message,'error');}
  }
  function divisionPositionLabel(){
    var mode=$('division-mode').value,horizontal=divisionEdit&&divisionEdit.axis==='horizontal';
    $('division-position-label').textContent=mode==='ratio'?'Posição (%)':mode==='start'?(horizontal?'Altura livre abaixo (mm)':'Largura livre à esquerda (mm)'):(horizontal?'Altura livre acima (mm)':'Largura livre à direita (mm)');
  }
  function divisionParams(){
    if(!divisionEdit||divisionEdit.key!==selectionKey)throw new Error('Selecione novamente a peça.');
    return divisionEdit.isNew?M.split(readForm(),divisionEdit.id,divisionEdit.axis):readForm();
  }
  $('division-mode').addEventListener('change',function(){try{
    if(divisionEdit&&divisionEdit.pending){divisionPositionLabel();refreshPins();return;}
    validateEditContext();
    if(!divisionEdit||!M.find(state.params,divisionEdit.id)){invalidateEditContext();throw new Error('Esta peça deixou de existir. Abra outra peça para editar.');}
    var p=divisionParams(),node=M.find(p,divisionEdit.id),r=M.layout(p).nodes[node.id],free=r[node.split==='horizontal'?'height':'width']-M.thickness(p,'split:'+node.id),distance=M.splitDistance(node,free);
    $('division-position').value=Math.round((this.value==='ratio'?distance/free*100:this.value==='end'?free-distance:distance)*100)/100;divisionPositionLabel();refreshPins();
  }catch(e){message(e.message,'error');}});
  $('divider-mode').addEventListener('change',function(){$('division-depth').value='';syncDivisionControls();});
  $('division-quantity').addEventListener('change',syncDivisionControls);
  $('division-type').addEventListener('change',function(){
    var type=this.value;
    if(type==='glass'&&['4','6','8','10'].indexOf($('division-thickness').value)<0)$('division-thickness').value='6';
    if(type==='mdf'&&userSettings.thicknesses.indexOf(Number($('division-thickness').value))<0)setValue('division-thickness',state.params.thickness||userSettings.thicknesses[0]||15);
    syncDivisionControls();
  });
  $('division-glass-color').addEventListener('change',syncDivisionControls);
  $('division-led').addEventListener('change',syncDivisionControls);

  function concludeDivisionInsert(intent){
    var targets=openingTargets();if(!targets.length)throw new Error('Selecione pelo menos um vão no SketchUp.');
    var kind=flow.creation.kind,axis=kind==='shelf'?'horizontal':'vertical',p=M.clone(flow.creation.baseParams),last=null,pref=captureDivisionPref();
    var quantity=M.number(pref.quantity,'Quantidade',1,8);if(quantity!==Math.floor(quantity))throw new Error('Quantidade deve ser inteira.');
    var thicknessValue=M.number(pref.thickness,'Espessura',3,40);
    var mode=pref.mode,value=M.number(pref.position,mode==='ratio'?'Proporção (%)':'Posição',0,mode==='ratio'?100:4000);
    var customSpan=kind==='shelf'||$('division-span').value.trim()===''?null:M.number($('division-span').value,'Medida da peça',50,4000);
    var customDepth=kind==='shelf'||$('divider-mode').value==='batente'&&kind==='divider'||$('division-depth').value.trim()===''?null:M.number($('division-depth').value,'Profundidade',50,1500);
    var insertionBatch='ins_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);
    targets.forEach(function(target){
      var targetWindow=M.windows(p).find(function(window){return window.id===target.id;});
      if(!targetWindow)return;
      var total=axis==='horizontal'?targetWindow.height:targetWindow.width;
      var uniformGap=quantity>1?(total-quantity*thicknessValue)/(quantity+1):null;
      if(quantity>1&&uniformGap<0)throw new Error('Não há espaço para '+quantity+' '+(kind==='shelf'?'prateleiras':'divisórias')+' neste vão.');
      var currentId=target.id;
      for(var index=0;index<quantity;index++){
        if(!M.windows(p).some(function(window){return window.id===currentId;}))throw new Error('Um dos vãos deixou de estar disponível durante a inserção.');
        p=M.split(p,currentId,axis);currentId=M.divisionId(p,currentId);
        var node=M.find(p,currentId),role='split:'+node.id;
        node.insertion_batch=insertionBatch;
        node.keep_divider_proportions=pref.keep_divider_proportions;
        if(quantity>1){node.position_mode='start';node.distance=uniformGap;}
        else{node.position_mode=mode;if(mode==='ratio')node.ratio=value/100;else node.distance=value;}
        if(!node.keep_divider_proportions){node.distance=M.splitDistance(node,total-thicknessValue);node.position_mode='start';}
        var data=M.clone(p.piece_settings[role]||{});delete data.adjustment;applyDivisionConstruction(data,pref,p,axis);
        setNewDivisionFrontBand(data,p,axis);
        p.piece_settings[role]=data;
        var base=M.layout(p).panels.find(function(board){return board.role===role;}),spanAxis=axis==='horizontal'?0:2,delta=[0,0,0];
        if(customSpan!==null)delta[spanAxis]=customSpan-base.size[spanAxis];
        if(customDepth!==null)delta[1]=customDepth-base.size[1];
        if(customSpan!==null||customDepth!==null)data.adjustment={size:delta,offset:[0,0,0]};
        p.piece_settings[role]=data;last=node.id+'/a';currentId=node.id+'/b';
      }
    });
    if(!last)throw new Error('Os vãos selecionados não estão mais disponíveis.');
    delete pref.position;delete pref.front_recess;insertionPrefs[kind]=pref;saveInsertionPrefs();
    state.selected=last;commitInternal(p,false,intent);
  }
  $('apply-division').addEventListener('click',function(event){try{
    if(insertSessionActive()){concludeDivisionInsert(editorIntent(event));return;}
    validateEditContext();
    if(!divisionEdit||!M.find(state.params,divisionEdit.id)){invalidateEditContext();throw new Error('Esta peça deixou de existir. Abra outra peça para editar.');}
    var p=divisionParams(),node=M.find(p,divisionEdit.id),role='split:'+node.id,mode=$('division-mode').value;
    node.position_mode=mode;var value=M.number($('division-position').value,mode==='ratio'?'Proporção (%)':'Posição',0,mode==='ratio'?100:4000);if(mode==='ratio')node.ratio=value/100;else node.distance=value;
    node.keep_divider_proportions=$('division-proportions').checked;
    if(!node.keep_divider_proportions){var region=M.layout(p).nodes[node.id];node.distance=M.splitDistance(node,region[node.split==='horizontal'?'height':'width']-M.thickness(p,role));node.position_mode='start';}
    var pref=captureDivisionPref(),data=M.clone(p.piece_settings[role]||{}),oldOffset=data.adjustment?data.adjustment.offset.slice():[0,0,0];
    delete data.adjustment;applyDivisionConstruction(data,pref,p,node.split);
    if(divisionEdit.isNew)setNewDivisionFrontBand(data,p,node.split);
    p.piece_settings[role]=data;
    var base=M.layout(p).panels.find(function(b){return b.role===role;}),spanAxis=node.split==='horizontal'?0:2,delta=[0,0,0];
    var span=node.split==='horizontal'||$('division-span').value.trim()===''?base.size[spanAxis]:M.number($('division-span').value,'Medida da peça',50,4000);
    var depth=node.split==='horizontal'||node.split==='vertical'&&pref.divider_mode==='batente'||$('division-depth').value.trim()===''?base.size[1]:M.number($('division-depth').value,'Profundidade',50,1500);
    delta[spanAxis]=span-base.size[spanAxis];delta[1]=depth-base.size[1];
    data.adjustment={size:delta,offset:oldOffset};p.piece_settings[role]=data;
    if(node.split==='vertical'&&Number(pref.quantity)>1)p=M.setDividerCount(p,node.id,Number(pref.quantity));
    state.pieceRole=role;commitInternal(p,false,editorIntent(event));
  }catch(e){message(e.message,'error');}});
  $('cancel-division').addEventListener('click',function(){if(insertSessionActive())cancelInsertSession();else{clearInternalEditors();updateChrome();}});

  function ensureUndoToast(){
    var toast=$('undo-toast');if(toast)return toast;
    toast=document.createElement('div');toast.id='undo-toast';toast.className='undo-toast';toast.hidden=true;
    var label=document.createElement('span');label.className='undo-toast-label';
    var button=document.createElement('button');button.type='button';button.className='undo-toast-action';button.textContent='Desfazer';
    button.addEventListener('click',function(){
      if(!lastUndo)return;
      if(String(state.target)!==String(lastUndo.target)){hideUndoToast();return;}
      var removal=lastUndo;
      try{
        var context=removal.context;
        if(!context||context.generation_id!==operations.generation||context.model_id!==operations.model||context.model_generation!==operations.modelGeneration)throw new Error('O contexto desta exclusão mudou. Abra novamente o módulo.');
        var restored=window.PlanyRecipeChanges.revert(removal.params,removal.after,readForm(),M.normalize);
        clearInternalEditors();lastUndo=null;hideUndoToast();undoRestorePending=true;
        commitInternal(restored,true);
      }catch(error){undoRestorePending=false;message(error.message,'error');}
    });
    toast.appendChild(label);toast.appendChild(button);document.body.appendChild(toast);return toast;
  }
  function hideUndoToast(){var toast=$('undo-toast');if(toast)toast.hidden=true;clearTimeout(undoTimer);undoTimer=null;}
  function showUndoToast(removal){
    lastUndo=removal;var toast=ensureUndoToast();toast.querySelector('.undo-toast-label').textContent='Removido: '+removal.label;
    toast.hidden=false;clearTimeout(undoTimer);undoTimer=setTimeout(function(){toast.hidden=true;lastUndo=null;undoTimer=null;},5000);
  }
  function showLibraryUndo(data){
    libraryUndo=data;
    var toast=$('library-undo-toast');
    if(!toast){
      toast=document.createElement('div');toast.id='library-undo-toast';toast.className='undo-toast';
      var label=document.createElement('span');label.className='undo-toast-label';label.textContent='Modelo removido da biblioteca.';
      var button=document.createElement('button');button.type='button';button.className='undo-toast-action';button.textContent='Desfazer';
      button.addEventListener('click',function(){if(!libraryUndo)return;var token=libraryUndo.token;libraryUndo=null;toast.hidden=true;clearTimeout(libraryUndoTimer);request('restore_library',[token]);});
      toast.appendChild(label);toast.appendChild(button);document.body.appendChild(toast);
    }
    toast.hidden=false;clearTimeout(libraryUndoTimer);
    libraryUndoTimer=setTimeout(function(){toast.hidden=true;libraryUndo=null;libraryUndoTimer=null;},5000);
  }
  function removeInserted(kind,id){
    if(state.busy)return;
    if(state.dirty){message('Conclua ou cancele a edição do módulo antes de remover uma inserção.','error');return;}
    try{
      var before=readForm(),p=M.clone(before),label;
      if(kind==='division'){
        label=divisionName('split:'+id,before);p=M.removeDivision(p,id);state.selected=id;state.pieceRole='';
      }else if(kind==='front'){
        var front=p.fronts.find(function(f){return f.id===id;});if(!front)throw new Error('A inserção não está mais disponível.');
        label=frontName(front);p.fronts=p.fronts.filter(function(f){return f.id!==id;});
        Object.keys(p.piece_settings).forEach(function(role){if(role.indexOf('front:'+id+':')===0)delete p.piece_settings[role];});
      }else if(kind==='cladding'){
        label=id==='all'?'Tamponamentos':'Tamponamento '+({left:'esquerdo',right:'direito',top:'superior',bottom:'inferior'}[id]||id);
        p.claddings=(p.claddings||[]).filter(function(v){return id!=='all'&&v.side!==id;});
        Object.keys(p.piece_settings).forEach(function(role){if(id==='all'?role.indexOf('cladding:')===0:role==='cladding:'+id||role.indexOf('cladding:'+id+':')===0)delete p.piece_settings[role];});
      }else if(kind==='trim'){
        label=id==='baseboard'?'Rodapé':'Rodateto';p.trims=(p.trims||[]).filter(function(v){return v.kind!==id;});
        Object.keys(p.piece_settings).forEach(function(role){if(role==='trim:'+id||role.indexOf('trim:'+id+':')===0)delete p.piece_settings[role];});
      }else if(kind==='accessory'){
        var accessory=(p.accessories||[]).find(function(v){return v.id===id;});if(!accessory)throw new Error('O acessório não está mais disponível.');
        label=accessory.name;p.accessories=p.accessories.filter(function(v){return v.id!==id;});
      }else throw new Error('Tipo de inserção inválido.');
      pendingRemoval={params:M.clone(before),target:state.target,label:label};
      clearInternalEditors();commitInternal(p);
    }catch(error){pendingRemoval=null;message(error.message,'error');}
  }
  function switchTab(name) {
    clearEdgeHover();
    var previous=document.querySelector('.tab.active');
    if(name==='settings'&&previous){settingsReturnTab=previous.dataset.tab;settingsReturnScroll=document.querySelector('main').scrollTop;}
    if(name==='settings')showSettingsPage('index');
    if(name==='materials'&&(!previous||previous.dataset.tab!=='materials')){
      $('catalog-brand').value='used';$('catalog-search').value='';catalogFavoritesView=false;clearCatalogPickStatus();
    }
    if(name!=='module'&&!insertSessionActive())cancelInsertTool();
    if(name==='extras'){name='module';setPiecesView(true);}
    else if(piecesView){piecesView=false;activateSelectionStep(activeSelectionStep,false);}
    document.querySelectorAll('.tab').forEach(function (button) {
      var active=button.getAttribute('data-tab')===name;
      button.classList.toggle('active',active); button.setAttribute('aria-selected',String(active));
    });
    document.querySelectorAll('.tab-panel').forEach(function (panel) { panel.hidden=panel.id!=='tab-'+name; });
    $('module-footer').hidden=name!=='module'||selectionKind!=='module';
    if (name==='library') request('list_library');
    if (name==='materials') {
      if(catalog.length){window.setTimeout(function(){if(!$('tab-materials').hidden)renderCatalog();},0);}
      else if(!nativeMode)renderCatalog();
      else if(!catalogRequestPending&&!state.busy){
        catalogRequestPending=true;$('catalog-empty').hidden=false;$('catalog-empty').textContent='Carregando materiais…';
        request('list_materials');
      }
    }
    updateChrome();
  }
  function mdfThicknesses(min,max){
    return userSettings.thicknesses.filter(function(value){return value>=min&&value<=max;})
      .map(function(value){return [value,String(value).replace('.',',')+' mm'];});
  }
  function applyThicknessOptions(){
    var limits={thickness:[6,40],back_thickness:[3,25],'bulk-front_thickness':[6,40],'bulk-thickness':[3,40],
      'solo-thickness':[3,40],'front-thickness':[6,40],'cladding-thickness':[6,40],
      'trim-thickness':[6,40],'piece-thickness':[3,40],'panel-thickness':[6,40],
      'panel-rib-thickness':[3,40],'panel-base-thickness':[3,40]};
    Object.keys(limits).forEach(function(id){
      var select=$(id),current=select.value,range=limits[id],items=mdfThicknesses(range[0],range[1]);
      if(id.indexOf('bulk-')===0)items.unshift(['','Não informado']);
      if(current&&items.every(function(item){return String(item[0])!==current;}))items.push([current,current.replace('.',',')+' mm · medida atual']);
      setSelectOptions(id,items,current);
    });
    var data=$('mdf-options');data.textContent='';
    var mirror=$('panel-mirror-thickness'),glass=[[4,'4 mm'],[6,'6 mm'],[8,'8 mm'],[10,'10 mm']],saved=mirror.value;
    if(saved&&glass.every(function(item){return String(item[0])!==saved;}))glass.push([saved,saved+' mm · medida atual']);
    setSelectOptions('panel-mirror-thickness',glass,saved||4);
    userSettings.thicknesses.forEach(function(value){var option=document.createElement('option');option.value=String(value);data.appendChild(option);});
    syncDivisionControls();
  }
  function parseSettingsThickness(text){
    return M.number(String(text).replace(',','.'),'Espessura de MDF',3,40);
  }
  function renderSettingsThicknesses(){
    settingsThicknessDraft=settingsThicknessDraft.slice().sort(function(a,b){return a-b;});
    var list=$('settings-thickness-list');list.textContent='';
    settingsThicknessDraft.forEach(function(value,index){
      var row=document.createElement('div'),input=document.createElement('input'),unit=document.createElement('span'),remove=document.createElement('button');
      row.className='settings-thickness-row';input.inputMode='decimal';input.value=String(value).replace('.',',');input.setAttribute('aria-label','Espessura '+(index+1));
      input.addEventListener('change',function(){try{
        var next=parseSettingsThickness(input.value);
        if(settingsThicknessDraft.some(function(item,other){return other!==index&&item===next;}))throw new Error('Esta espessura já está na lista.');
        settingsThicknessDraft[index]=next;renderSettingsThicknesses();
      }catch(error){input.value=String(value).replace('.',',');message(error.message,'error');}});
      unit.textContent='mm';remove.className='settings-thickness-remove';remove.type='button';remove.textContent='×';
      remove.setAttribute('aria-label','Remover '+String(value).replace('.',',')+' mm');
      remove.addEventListener('click',function(){settingsThicknessDraft.splice(index,1);renderSettingsThicknesses();});
      row.appendChild(input);row.appendChild(unit);row.appendChild(remove);list.appendChild(row);
    });
    $('settings-thickness-empty').hidden=settingsThicknessDraft.length>0;
  }
  function renderSettingsMaterials(){
    refreshMaterialButtons();
  }
  function settingsDependentVisibility(){
    var hiddenEnabled=$('settings-surplus-enabled').checked,limitEnabled=$('settings-hinged-width-enabled').checked;
    $('settings-hidden-material').disabled=!hiddenEnabled;
    $('settings-hidden-material').closest('.field').hidden=!hiddenEnabled;
    $('settings-hinged-max-width').disabled=!limitEnabled;
    $('settings-hinged-max-width').closest('.field').hidden=!limitEnabled;
    refreshMaterialButtons();
  }
  function settingsBackVisibility(){
    var enabled=$('settings-back').checked,rails=$('settings-back-panel-type').value==='rails',mount=$('settings-back-type').value;
    $('settings-back-configuration').hidden=!enabled;
    $('settings-back-mount-field').hidden=rails;
    $('settings-back-groove-field').hidden=rails||mount!=='groove';
    $('settings-back-setback-field').hidden=rails||mount==='applied';
  }
  function renderSettings(){
    renderSettingsThicknesses();
    ['structure','front','hidden'].forEach(function(kind){$('settings-'+kind+'-material').value=userSettings[kind+'_material'];});
    $('settings-surplus-enabled').checked=userSettings.surplus_enabled;
    $('settings-hidden-material').disabled=!userSettings.surplus_enabled;
    ['base-type','bottom-type','top-join','top-type','back-type','back-panel-type','theme'].forEach(function(key){$('settings-'+key).value=userSettings[key.replace(/-/g,'_')];});
    $('settings-back').checked=userSettings.back;
    $('settings-back-setback').value=userSettings.back_setback;
    $('settings-back-groove-depth').value=userSettings.back_groove_depth;
    settingsBackVisibility();
    $('settings-sheet-length').value=userSettings.sheet_length||2750;$('settings-sheet-width').value=userSettings.sheet_width||1850;
    $('settings-hinged-width-enabled').checked=userSettings.hinged_width_enabled!==false;
    $('settings-hinged-max-width').value=userSettings.hinged_max_width||600;$('settings-hinged-max-width').disabled=userSettings.hinged_width_enabled===false;
    settingsDependentVisibility();
    $('settings-precision').value=String(userSettings.precision);
    $('settings-command-suggestions').checked=userSettings.command_suggestions!==false;
    $('settings-command-stay-active').checked=userSettings.command_stay_active!==false;
    $('settings-command-space-as-enter').checked=userSettings.command_space_as_enter===true;
    var aliasList=$('settings-command-aliases');aliasList.textContent='';
    commandCatalog.forEach(function(command){
      var label=document.createElement('label'),name=document.createElement('span'),input=document.createElement('input');
      label.className='command-alias-row';name.textContent=command.family+'; '+command.name;
      input.type='text';input.maxLength=32;input.autocomplete='off';input.placeholder='Apelido opcional';
      input.dataset.commandAlias=command.id;input.value=(userSettings.command_aliases||{})[command.id]||'';
      label.appendChild(name);label.appendChild(input);aliasList.appendChild(label);
    });
    renderSettingsMaterials();
    if(window.planyGroupEditor)window.planyGroupEditor($('settings-command-aliases'));
  }
  var settingsPages={
    index:{title:'Configurações'},
    materials:{title:'Materiais e peças',parent:'index',scope:'Padrões usados na criação e validação de novas peças.'},
    construction:{title:'Construção dos módulos',parent:'index',scope:'Padrões construtivos usados ao criar novos módulos.'},
    'construction-caixaria':{title:'Caixaria',parent:'construction',scope:'Padrões usados em novas caixarias.'},
    interface:{title:'Interface',parent:'index',scope:'Preferências pessoais de apresentação.'},
    commands:{title:'Modo Comandos',parent:'index',scope:'Preferências pessoais do fluxo por comandos.'},
    'command-aliases':{title:'Apelidos',parent:'commands'}
  };
  function showSettingsPage(name){
    var page=settingsPages[name];if(!page)return;
    settingsPage=name;
    document.querySelectorAll('[data-settings-page]').forEach(function(panel){panel.hidden=panel.dataset.settingsPage!==name;});
    $('settings-title').textContent=page.title;
    $('settings-scope').textContent=page.scope||'';$('settings-scope').hidden=!page.scope;
    $('settings-return').textContent=page.parent?'← '+settingsPages[page.parent].title:'← Voltar ao Plany';
    document.querySelector('main').scrollTop=0;
    if(editorPolicy)updateChrome();
  }
  document.querySelectorAll('[data-settings-open]').forEach(function(button){
    button.addEventListener('click',function(){showSettingsPage(button.dataset.settingsOpen);});
  });
  $('settings-thickness-add').addEventListener('click',function(){try{
    var value=parseSettingsThickness($('settings-thickness-new').value);
    if(settingsThicknessDraft.indexOf(value)>=0)throw new Error('Esta espessura já está na lista.');
    settingsThicknessDraft.push(value);$('settings-thickness-new').value='';renderSettingsThicknesses();
  }catch(error){message(error.message,'error');}});
  $('settings-thickness-new').addEventListener('keydown',function(event){if(event.key==='Enter'){event.preventDefault();$('settings-thickness-add').click();}});
  $('settings-surplus-enabled').addEventListener('change',settingsDependentVisibility);
  ['settings-back','settings-back-type','settings-back-panel-type'].forEach(function(id){$(id).addEventListener('change',settingsBackVisibility);});
  $('settings-command-reset-aliases').addEventListener('click',function(){
    document.querySelectorAll('[data-command-alias]').forEach(function(input){input.value='';});
  });
  $('settings-return').addEventListener('click',function(){
    var parent=settingsPages[settingsPage].parent;
    if(parent)showSettingsPage(parent);else switchTab(settingsReturnTab);
  });
  $('settings-hinged-width-enabled').addEventListener('change',settingsDependentVisibility);
  $('settings-save').addEventListener('click',function(){
    var raw={thicknesses:settingsThicknessDraft.slice(),surplus_enabled:$('settings-surplus-enabled').checked,back:$('settings-back').checked,
      precision:Number($('settings-precision').value),command_suggestions:$('settings-command-suggestions').checked,
      command_stay_active:$('settings-command-stay-active').checked,
      command_space_as_enter:$('settings-command-space-as-enter').checked,command_aliases:{},
      sheet_length:$('settings-sheet-length').value,sheet_width:$('settings-sheet-width').value,
      back_setback:$('settings-back-setback').value,back_groove_depth:$('settings-back-groove-depth').value,
      hinged_width_enabled:$('settings-hinged-width-enabled').checked,hinged_max_width:$('settings-hinged-max-width').value};
    document.querySelectorAll('[data-command-alias]').forEach(function(input){if(input.value.trim())raw.command_aliases[input.dataset.commandAlias]=input.value.trim();});
    ['structure','front','hidden'].forEach(function(kind){raw[kind+'_material']=$('settings-'+kind+'-material').value.trim();});
    ['base-type','bottom-type','top-join','top-type','back-type','back-panel-type','theme'].forEach(function(key){raw[key.replace(/-/g,'_')]=$('settings-'+key).value;});
    request('save_settings',[raw]);
  });
  function rule() {
    var result={};
    ['width','height','depth'].forEach(function (key) { result[key]={follow:$('follow-'+key).checked,anchor:$('anchor-'+key).value}; });
    return result;
  }
  function fillRule(value) {
    ['width','height','depth'].forEach(function (key) {
      $('follow-'+key).checked=value[key].follow; $('anchor-'+key).value=value[key].anchor;
    });
    describeRule();
  }
  function preset(name) {
    var value=fixedRule();
    if (name==='side') { value.width.anchor='end'; value.height.follow=true; value.depth.follow=true; }
    if (name==='rail') { value.width.follow=true; value.height.anchor='end'; }
    fillRule(value);
  }
  function fixedRule(){return {width:{follow:false,anchor:'start'},height:{follow:false,anchor:'start'},depth:{follow:false,anchor:'start'}};}
  function describeRule() {
    var value=rule(), labels={width:'largura',height:'altura',depth:'profundidade'};
    var followed=Object.keys(value).filter(function (key) { return value[key].follow; }).map(function (key) { return labels[key]; });
    $('rule-description').textContent=followed.length?'A peça cresce ou diminui junto com a '+followed.join(' e ')+'. As outras medidas permanecem fixas. A referência define como ela se posiciona.':'As medidas da peça ficam fixas. A referência define se ela acompanha a esquerda, direita, centro, base, topo, frente ou trás do módulo.';
  }
  function rememberModelRule(){if(modelConfig&&modelConfig.parts[modelConfig.selected])modelConfig.parts[modelConfig.selected].rule=rule();}
  function renderModelBehavior(){
    if(!modelConfig)return;
    $('library-content').hidden=true;$('library-config').hidden=false;
    $('library-config-title').textContent='Configurar modelo · '+modelConfig.name;
    var list=$('model-behavior-parts');list.textContent='';
    if(!modelConfig.parts.length){var empty=document.createElement('p');empty.className='empty';empty.textContent='Este modelo não possui peças avulsas para configurar.';list.appendChild(empty);}
    modelConfig.parts.forEach(function(part,index){
      var button=document.createElement('button');button.type='button';button.className='model-behavior-item'+(index===modelConfig.selected?' active':'');
      button.textContent=part.name;button.addEventListener('click',function(){rememberModelRule();modelConfig.selected=index;renderModelBehavior();});list.appendChild(button);
    });
    var selected=modelConfig.parts[modelConfig.selected];$('piece-rule-editor').hidden=!selected;
    if(selected){$('rule-preset').value='custom';fillRule(selected.rule);}
    updateChrome();
  }
  function demoLibrary() {
    return { starters:[{id:'starter:base',name:'Caixaria',params:Object.assign(M.clone(M.defaults),{name:'Caixaria'})}],saved:[],directory:'A biblioteca será guardada no seu computador após a instalação.' };
  }
  var libraryRenamePending=null;
  function renderLibrary(data) {
    state.library=data;
    function cards(container, entries, saved) {
      container.textContent='';
      if (!entries.length) { var empty=document.createElement('p'); empty.className=saved?'library-empty':'empty'; empty.textContent=saved?'Nenhum modelo salvo.':'Seus modelos aparecerão aqui, com todas as peças que você acrescentar.'; container.appendChild(empty); }
      entries.forEach(function (entry) {
        var button=document.createElement('button'); button.className='library-card'; button.setAttribute('aria-label','Inserir '+entry.name);
        var svg=el('svg',{viewBox:'0 0 400 260','aria-hidden':'true'});
        draw(svg,M.normalize(entry.params),false);
        var detail=document.createElement('div'), name=document.createElement('strong'), dimensions=document.createElement('p'), insert=document.createElement('span');
        name.textContent=entry.name; dimensions.textContent=format(entry.params.width)+' × '+format(entry.params.height)+' × '+format(entry.params.depth)+' mm'+(entry.extras?' · +'+countText(entry.extras,'peça','peças'):'');
        insert.className='insert'; insert.textContent='Inserir módulo ↗';
        detail.appendChild(name); detail.appendChild(dimensions); detail.appendChild(insert); button.appendChild(svg); button.appendChild(detail);
        button.addEventListener('click',function () {
          rememberDraft();
          request('insert_library',[entry.id]);
        });
        if(saved){
          var wrapper=document.createElement('div'),menuButton=document.createElement('button'),menu=document.createElement('div'),configure=document.createElement('button'),rename=document.createElement('button'),remove=document.createElement('button');
          wrapper.className='library-model-card';wrapper.dataset.libraryId=entry.id;menuButton.type='button';menuButton.className='library-model-menu-button';menuButton.textContent='⋯';
          menuButton.title='Opções de '+entry.name;menuButton.setAttribute('aria-label',menuButton.title);
          menu.className='library-model-menu';menu.hidden=true;configure.type='button';configure.textContent='Configurar modelo';
          rename.type='button';rename.textContent='Renomear';remove.type='button';remove.textContent='Remover da Biblioteca';remove.className='danger';
          menuButton.addEventListener('click',function(){document.querySelectorAll('.library-model-menu').forEach(function(other){if(other!==menu)other.hidden=true;});menu.hidden=!menu.hidden;});
          configure.addEventListener('click',function(){menu.hidden=true;request('model_behavior',[entry.id]);});
          rename.addEventListener('click',function(){
            menu.hidden=true;
            if(libraryRenamePending){libraryRenamePending.editor.element.querySelector('input').focus();return;}
            button.disabled=menuButton.disabled=true;
            var pending={id:entry.id,value:null,operation:null,editor:null};libraryRenamePending=pending;
            pending.editor=U.inlineRename(wrapper,entry.name,function(value,result){
              pending.value=value;var op=request('rename_library',[entry.id,value]);
              if(op)pending.operation=op.operation_id;
              else result('Não foi possível salvar o nome. Tente novamente.');
            },function(){
              libraryRenamePending=null;button.disabled=menuButton.disabled=false;if(state.library)renderLibrary(state.library);
              window.setTimeout(function(){var row=Array.prototype.find.call(document.querySelectorAll('[data-library-id]'),function(item){return item.dataset.libraryId===entry.id;});if(row&&!$('tab-library').hidden)row.querySelector('.library-model-menu-button').focus();},0);
            });
          });
          remove.addEventListener('click',function(){
            menu.hidden=true;
            request('delete_library',[entry.id]);
          });
          menu.appendChild(configure);menu.appendChild(rename);menu.appendChild(remove);wrapper.appendChild(button);wrapper.appendChild(menuButton);wrapper.appendChild(menu);container.appendChild(wrapper);
        }else container.appendChild(button);
      });
    }
    cards($('starters'),data.starters,false);
    if(!libraryRenamePending)cards($('saved-library'),data.saved,true);
    renderPieceLibrary('piece-starters',data.piece_starters||[]);
    renderPieceLibrary('saved-pieces',data.saved_pieces||[]);
    $('library-path').textContent='Biblioteca neste computador'+(data.invalid?' · '+U.count(data.invalid,'item incompleto não exibido.','itens incompletos não exibidos.'):'');
  }
  function constructionVisibility() {
    var backEnabled=$('back').checked,backRails=$('back_panel_type').value==='rails';
    $('back_thickness').disabled=!backEnabled||backRails;
    $('back_type').disabled=!backEnabled||backRails;
    $('back_panel_type').disabled=!backEnabled;
    $('back-configuration').hidden=!backEnabled;
    $('back-thickness-field').hidden=backEnabled&&backRails;
    $('back-material-field').hidden=backEnabled&&backRails;
    $('back-mount-field').hidden=backEnabled&&backRails;
    $('rail-field').hidden=$('top_type').value!=='rails';
    $('bottom-rail-field').hidden=$('bottom_type').value!=='rails';
    $('back-rail-field').hidden=!backEnabled||!backRails;
    $('back-groove-field').hidden=!backEnabled||backRails||$('back_type').value!=='groove';
    $('setback-field').hidden=!backEnabled||backRails||$('back_type').value==='applied';
  }
  function renderFronts(info) {
    $('front-summary').textContent=state.params.fronts.length?U.count(state.params.fronts.length,'inserção','inserções'):'Sem frentes';
    var list=$('front-list');list.textContent='';
    state.params.fronts.forEach(function(f){
      var row=document.createElement('div'),text=document.createElement('span'),button=document.createElement('button'),detail=document.createElement('small');
      row.className='internal-row';text.textContent=frontName(f);detail.textContent=frontDetail(f);text.appendChild(detail);
      button.className='small-button danger';button.textContent='Remover';
      button.addEventListener('click',function(){
        removeInserted('front',f.id);
      });
      var edit=document.createElement('button');edit.className='small-button';edit.textContent='Editar';edit.title='Configurar este conjunto';edit.dataset.front=f.id;edit.setAttribute('aria-label','Configurar '+frontName(f));
      edit.addEventListener('click',function(){
        if(state.busy)return;clearInternalEditors();state.editingFront=f.id;editingFrontNodes=f.nodes.slice();flow.openings=[];flow.opening=null;
        ['kind','count','fit','gap','thickness','material','side'].forEach(function(k){setValue('front-'+k,f[k]===undefined?'front':f[k]);});
        ['left','right','bottom','top'].forEach(function(edge){$('front-gap-'+edge).value=f['gap_'+edge]===undefined?f.gap:f['gap_'+edge];});
        if(f.kind==='drawers'&&f.hardware_layout_version!==1&&f.fit==='overlay')$('front-gap-bottom').value='0';
        $('door-type').value=f.door_type||'hinged';
        $('door-hinged-mode').value=f.count===2||f.door_opening==='double'?'double':f.door_opening==='right'?'right':'left';
        $('door-lift-opening').value=f.door_opening==='bottom'?'bottom':'top';
        $('door-lift-system').value=f.lift_system==='mechanical'?'mechanical':'gas';
        $('door-sliding-count').value=String(f.count);fillExtraFront(f);
        $('drawer-clearance').value=f.slide_clearance;$('drawer-height').value=f.box_height;$('drawer-depth').value=f.box_depth;$('drawer-box-material').value=f.box_material||'';
        drawerOpeningKey=String(state.target)+'|'+editingFrontNodes.slice().sort().join('|');drawerHeightManual=true;drawerHeightRequested=f.box_height;drawerDepthManual=f.box_depth_auto===false;
        $('drawer-height-difference').value=f.box_height_difference;
        $('drawer-runner-height').value=f.runner_height===undefined?44:f.runner_height;
        $('drawer-runner-drop').value=f.runner_drop===undefined?10:f.runner_drop;
        $('drawer-base-clearance').value=f.runner==='telescopic'&&f.hardware_layout_version===1?$('drawer-runner-drop').value:(f.base_clearance===undefined?10:f.base_clearance);
        $('drawer-front-projection').value=f.front_projection===undefined?15:f.front_projection;
        $('drawer-runner').value=f.runner;$('drawer-visibility').value=f.visibility;$('drawer-recess').value=f.recess;
        $('drawer-face-recess').value=f.face_recess===undefined?0:f.face_recess;
        $('drawer-rear-clearance').value=Math.max(10,f.rear_clearance||10);
        drawerDepthReference=f.kind==='drawers'?{start:M.drawerBoxStart(f,M.thickness(state.params,'front:'+f.id+':0:face',f.thickness)),clearance:f.rear_clearance||10}:null;
        $('drawer-settings').open=$('drawer-hardware-settings').open=false;
        showFrontEditor(f.kind);$('front-config').open=false;refreshMaterialButtons();updateChrome();
      });
      row.appendChild(text);row.appendChild(edit);row.appendChild(button);list.appendChild(row);
    });
  }
  function drawerVisibility(){
    var drawer=$('front-kind').value==='drawers',internal=drawer&&$('drawer-visibility').value==='internal';
    var mainFronts=$(drawer?'drawer-main-fronts':'door-main-fronts');
    mainFronts.appendChild($('front-fit-field'));
    mainFronts.appendChild($('front-material-field'));
    if(drawer)mainFronts.insertBefore($('drawer-face-recess-field'),$('front-material-field'));
    $('drawer-face-recess-field').hidden=!drawer||internal||$('front-fit').value!=='inset';
    $('door-main-fronts').hidden=drawer;
    $('drawer-settings').hidden=$('drawer-options').hidden=!drawer;
    $('drawer-main-fronts').hidden=!drawer||internal;
    $('drawer-visibility-field').hidden=!internal;
    $('drawer-recess-field').hidden=!internal;$('visible-front-options').hidden=internal;
    $('drawer-front-margins').hidden=internal;
    $('front-config').hidden=internal;
    $('drawer-hardware-settings').hidden=!drawer;
    $('drawer-telescopic-settings').hidden=$('drawer-runner').value!=='telescopic';syncExtraFrontControls();
  }
  function syncDrawerBoxMeasurements(changedQuantity){
    if($('front-kind').value!=='drawers'||$('front-editor').hidden)return;
    if(isLooseDrawer()){if(!$('drawer-depth').value)$('drawer-depth').value=state.params.depth;if(!$('drawer-height').value)$('drawer-height').value=state.params.height;return;}
    var targets=openingTargets();
    if(!targets.length&&state.editingFront&&!frontTargetChanging)targets=(editingFrontNodes||[]).map(function(id){return {id:id};});
    var key=targets.length?String(state.target)+'|'+targets.map(function(item){return item.id;}).sort().join('|'):'';
    if(key!==drawerOpeningKey){drawerOpeningKey=key;drawerDepthManual=false;drawerHeightManual=false;drawerHeightRequested=null;drawerDepthReference=null;}
    if(changedQuantity){drawerHeightManual=false;drawerHeightRequested=null;}
    if(!targets.length){
      if(!drawerDepthManual)$('drawer-depth').value='';
      if(!drawerHeightManual)$('drawer-height').value='';
      return;
    }
    var recipe=M.clone(state.params);recipe.fronts=[];
    var windows=M.windows(recipe),emptyLayout=M.layout(recipe),back=emptyLayout.panels.find(function(piece){return piece.role==='back';});
    var count=Number($('front-count').value),thickness=Number($('front-thickness').value);
    var clearanceText=$('drawer-rear-clearance').value.trim(),faceText=$('drawer-face-recess').value.trim();
    var clearance=Number(clearanceText.replace(',','.')),faceRecess=Number(faceText.replace(',','.'));
    if(!clearanceText||!Number.isFinite(clearance)||clearance<10||clearance>1500||$('front-fit').value==='inset'&&(!faceText||!Number.isFinite(faceRecess)||faceRecess<0))return;
    var start=M.drawerBoxStart({fit:$('front-fit').value,visibility:$('drawer-visibility').value,recess:Number($('drawer-recess').value.replace(',','.')),face_recess:faceRecess,thickness:thickness,hardware_layout_version:$('drawer-runner').value==='telescopic'?1:0});
    if(!Number.isFinite(start))return;
    var depths=[],heights=[];
    targets.forEach(function(target){
      var opening=windows.find(function(item){return item.id===target.id;}),region=emptyLayout.openings.find(function(item){return item.id===target.id;});
      if(!opening||!region)return;
      depths.push(Math.min(opening.rear,back?back.origin[1]:opening.rear)-opening.front-start-clearance);
      var z=region.z,rh=region.height,drop=Number($('drawer-runner-drop').value),projection=Number($('drawer-front-projection').value),between=Number($('front-gap').value);
      var telescopic=$('drawer-runner').value==='telescopic',internal=$('drawer-visibility').value==='internal';
      var bottomGap=Number($('front-gap-bottom').value),topGap=Number($('front-gap-top').value),overlay=$('front-fit').value==='overlay';
      var baseThickness=M.thickness(recipe,recipe.bottom_type==='rails'?'bottom:front':'bottom'),topThickness=M.thickness(recipe,recipe.top_type==='full'?'top':'rail:front');
      var lower=overlay?(Math.abs(z-baseThickness)<1e-7?bottomGap:z-region.edges[2]/2+bottomGap/2):z+bottomGap;
      var top=overlay?(Math.abs(z+rh-(recipe.height-topThickness))<1e-7?recipe.height-topGap:z+rh+region.edges[3]/2-topGap/2):z+rh-topGap;
      var faceH=(top-lower-(count-1)*between)/count,firstBottom=z+drop,offset=firstBottom-lower,boxBottoms=[];
      for(var di=0;di<count;di++){
        var faceBottom=lower+di*(faceH+between);
        boxBottoms.push(telescopic?(di===0?firstBottom:overlay?faceBottom+offset:Math.max(z+di*rh/count+5,faceBottom+projection)):z+di*rh/count+5);
      }
      var limits=boxBottoms.map(function(value,idx){
        var faceTop=lower+(idx+1)*faceH+idx*between;
        var underNext=(idx+1<count?boxBottoms[idx+1]-2:z+rh-10)-value;
        return internal?underNext:Math.min(faceH,faceTop-value,underNext);
      });
      heights.push(Math.min.apply(null,limits));
    });
    function safeMeasure(values){
      var value=Math.min.apply(null,values);
      return values.length&&Number.isFinite(value)&&value>0?measureText(Math.floor((value+1e-7)*1000)/1000):'';
    }
    if(!drawerDepthManual){var available=safeMeasure(depths),numeric=Number(String(available).replace(',','.'));$('drawer-depth').value=$('drawer-runner').value==='telescopic'&&numeric>=150?String(Math.min(1000,Math.floor(numeric/50)*50)):available;}
    drawerDepthReference={start:start,clearance:clearance};
    var maximum=safeMeasure(heights);
    if(!drawerHeightManual)$('drawer-height').value=maximum;
    else if(maximum!==''&&drawerHeightRequested!==null){
      var requested=String(drawerHeightRequested).trim().replace(',','.');
      if(/^\d+(?:\.\d+)?$/.test(requested))$('drawer-height').value=measureText(Math.min(Number(requested),Number(String(maximum).replace(',','.'))));
    }
  }
  function showFrontEditor(kind){
    $('front-kind').value=kind;var noun=kind==='drawers'?'gaveta':'porta',session=insertSessionActive();
    $('front-editor-title').textContent=session?'Configurar '+noun:state.editingFront?'Editar '+noun:'Configurar '+noun;
    $('front-config-title').textContent=kind==='drawers'?'Frentes':'Medidas e folgas';
    $('add-front').textContent=session?'Concluir inserção':state.editingFront?'Concluir edição':'Inserir '+noun+' no módulo';
    $('door-settings').hidden=kind!=='door';
    $('front-count-row').hidden=kind==='door';
    $('front-editor').hidden=false;
    $('cancel-front-edit').textContent=session?'Cancelar inserção':'Cancelar edição';
    $('front-target-row').hidden=!state.editingFront||session;
    if(state.editingFront)$('front-target-text').textContent=frontTargetChanging?'Clique no vão no SketchUp.':(editingFrontNodes||[]).length+' '+((editingFrontNodes||[]).length===1?'vão vinculado':'vãos vinculados');
    drawerVisibility();syncDoorControls();updateInsertTargetCount();
  }
  function chooseFront(kind,keepTool){
    if(state.busy)return;if(!keepTool)cancelInsertTool();clearInternalEditors(keepTool);
    var pref=insertionPref(kind);
    $('front-count').value=pref.count;
    $('front-fit').value=pref.fit;$('front-gap').value=pref.gap;setValue('front-thickness',pref.thickness||state.params.thickness);$('front-material').value=state.params.apparent_material||state.params.material;$('drawer-box-material').value='';
    ['left','right','bottom','top'].forEach(function(edge){$('front-gap-'+edge).value=pref['gap_'+edge]===undefined?pref.gap:pref['gap_'+edge];});
    $('front-side').value='front';
    $('door-type').value=pref.door_type||'hinged';
    $('door-hinged-mode').value=Number(pref.count)===2||pref.door_opening==='double'?'double':pref.door_opening==='right'?'right':'left';
    $('door-lift-opening').value=pref.door_opening==='bottom'?'bottom':'top';
    $('door-lift-system').value=pref.lift_system==='mechanical'?'mechanical':'gas';
    $('door-sliding-count').value=String(pref.count||2);fillExtraFront({kind:kind});
    $('drawer-runner').value=pref.runner||'telescopic';$('drawer-visibility').value='external';$('drawer-clearance').value=pref.clearance||'14';$('drawer-recess').value=pref.recess||'22';
    $('drawer-runner-height').value=pref.runner_height||'44';$('drawer-runner-drop').value=pref.runner_drop||'10';$('drawer-base-clearance').value=pref.runner==='telescopic'?$('drawer-runner-drop').value:(pref.base_clearance||'10');$('drawer-front-projection').value=pref.front_projection||'15';
    drawerOpeningKey='';drawerDepthManual=false;drawerHeightManual=false;drawerHeightRequested=null;drawerDepthReference=null;
    $('drawer-height').value='';$('drawer-depth').value='';
    $('drawer-height-difference').value=pref.box_height_difference===undefined?'5':pref.box_height_difference;
    $('drawer-face-recess').value='5';
    $('drawer-rear-clearance').value='10';
    $('drawer-settings').open=$('drawer-hardware-settings').open=false;
    $('front-config').open=false;
    syncDoorControls();showFrontEditor(kind);if(kind==='drawers'&&openingTargets().length)syncDrawerBoxMeasurements(false);refreshMaterialButtons();updateChrome();
  }
  function captureFrontPref(kind){
    syncDoorControls();
    var doorType=$('door-type').value,doorOpening=doorType==='hinged'?$('door-hinged-mode').value:doorType==='lift'?$('door-lift-opening').value:'top';
    return {count:$('front-count').value,fit:$('front-fit').value,gap:$('front-gap').value,
      gap_left:$('front-gap-left').value,gap_right:$('front-gap-right').value,gap_bottom:$('front-gap-bottom').value,gap_top:$('front-gap-top').value,
      thickness:$('front-thickness').value,material:$('front-material').value||'',box_material:$('drawer-box-material').value||'',side:$('front-side').value,
      door_type:doorType,door_opening:doorOpening,lift_system:$('door-lift-system').value,
      runner:$('drawer-runner').value,visibility:$('drawer-visibility').value,clearance:$('drawer-clearance').value,
      recess:$('drawer-recess').value,face_recess:$('drawer-face-recess').value,rear_clearance:$('drawer-rear-clearance').value,box_height:$('drawer-height').value,box_depth:$('drawer-depth').value,box_depth_auto:!drawerDepthManual,
      box_height_difference:$('drawer-height-difference').value,runner_height:$('drawer-runner-height').value,
      runner_drop:$('drawer-runner-drop').value,base_clearance:$('drawer-base-clearance').value,front_projection:$('drawer-front-projection').value,hardware_layout_version:1};
  }
  function rememberFrontPref(kind){var pref=captureFrontPref(kind);delete pref.material;
    ['gap','gap_left','gap_right','gap_bottom','gap_top','clearance','recess','rear_clearance','box_height','box_depth',
      'box_height_difference','runner_height','runner_drop','base_clearance','front_projection'].forEach(function(key){delete pref[key];});
    insertionPrefs[kind]=pref;saveInsertionPrefs();}
  function cancelInsertTool(){
    setActiveInsertTool(null);
    if(openingSessionId&&nativeMode&&window.sketchup&&typeof window.sketchup.clear_opening==='function'){
      if(operations.pending('opening_selection'))operations.cancel('opening_selection');
      var id=openingSessionId;openingSessionId=null;request('clear_opening',[id],true);
    }
  }
  function cancelInsertSession(){
    if(!flow.current)return;
    if(flow.current.pending){message('Aguarde a conclusão desta alteração antes de cancelar.','error');return;}
    if(flow.current&&flow.current.applied&&flow.current.appliedParams){
      try{commitInternal(window.PlanyRecipeChanges.revert(flow.current.baseParams,flow.current.appliedParams,state.params,M.normalize),true,'cancel');}
      catch(error){message(error.message,'error');}return;
    }
    finishVolumeSession();flow.dismiss('cancelled');closeCompletedSession();
  }

  function openCommandInsert(command){
    if(state.busy||state.dirty||!state.target||state.conflict){
      message('Selecione um módulo Plany sem alterações pendentes antes de inserir.','error');return;
    }
    var kind=command.kind,quantity=Number(command.quantity)||1;
    if(!Object.prototype.hasOwnProperty.call(insertToolButtons,kind)){
      message('Esta inserção não está disponível.','error');return;
    }
    commandInsertPending=true;
    switchTab('module');activateSelectionStep('front-details',false);
    if(['door','drawers','shelf','divider'].indexOf(kind)>=0){
      startInsertTool(kind);
      if(kind==='door'){
        $('door-type').value='hinged';
        $('front-count').value=String(quantity);
        $('door-hinged-mode').value=quantity===2?'double':'left';
        syncDoorControls();
      }else if(kind==='drawers')$('front-count').value=String(quantity);
      else $('division-quantity').value=String(quantity);
    }else beginSimpleInsert(kind);
  }
  function startInsertTool(kind){
    var originScroll=document.querySelector('main').scrollTop;
    if(kind==='door'&&volumeContext){beginVolumeInsert(kind);return;}
    if(state.busy||state.dirty||!state.target||state.conflict)return;
    if(!userSettings.thicknesses.length){message('Adicione uma espessura de MDF em Configurações antes de inserir uma peça.','error');return;}
    if(activePaint)endPaintSession();clearInternalEditors();flow.opening=null;flow.openings=[];
    flow.start(kind,'create',{baseParams:M.clone(state.params),originScroll:originScroll,selecting:['door','drawers','shelf','divider'].indexOf(kind)>=0});setActiveInsertTool(kind);
    if(kind==='door'||kind==='drawers')chooseFront(kind,true);
    else openPendingDivision(kind);
    updateInsertTargetCount();updateChrome();document.querySelector('main').scrollTop=0;
    if(kind==='door'&&flow.current)flow.current.doorTargetEnvelope=externalSliding();
    request('select_openings',[kind,false,null,kind==='door'&&externalSliding()]);
  }
  function beginInsertSession(kind){
    if(!flow.creation||flow.creation.kind!==kind)return;
    updateInsertTargetCount();updateChrome();
  }

  var slidingLeafDrafts=[],slidingTracksManual=false;
  function isLooseDrawer(){return !!(flow&&flow.volume&&flow.volume.kind==='drawer'||state.params.module_family==='functional'&&state.params.component_kind==='drawer');}
  function readSlidingLeaves(){
    var rows=[].slice.call($('sliding-leaves').children);if(!rows.length)return slidingLeafDrafts||[];
    return rows.map(function(row,index){var leaf=Object.assign({},slidingLeafDrafts[index]||{});row.querySelectorAll('[data-sliding-key]').forEach(function(control){var key=control.dataset.slidingKey;leaf[key]=key==='track'?Number(control.value)-1:key==='width'&&control.value===''?0:control.value;});return leaf;});
  }
  function renderSlidingLeaves(leaves){
    leaves=leaves||[];slidingLeafDrafts=leaves;var host=$('sliding-leaves');host.textContent='';
    var count=Number($('door-sliding-count').value)||1,tracks=Number($('sliding-tracks').value)||1;
    for(var i=0;i<count;i++){
      var leaf=leaves[i]||{},card=document.createElement('details'),heading=document.createElement('summary');card.className='item-config';heading.textContent='Folha '+(i+1);card.appendChild(heading);
      function field(label,key,fallback,options){var row=document.createElement('label');row.className='field';row.appendChild(document.createTextNode(label));var control=document.createElement(options?'select':'input');control.dataset.slidingKey=key;control.id='sliding-leaf-'+i+'-'+key;control.inputMode='decimal';if(options)options.forEach(function(option){var node=document.createElement('option');node.value=option[0];node.textContent=option[1];control.appendChild(node);});control.value=leaf[key]===undefined?fallback:leaf[key];row.appendChild(control);card.appendChild(row);return control;}
      var type=field('Material da folha','type','mdf',[['mdf','MDF'],['profile_mdf','Perfil de alumínio + MDF'],['profile_glass','Perfil de alumínio + vidro'],['profile_mirror','Perfil de alumínio + espelho']]);
      var material=field('MDF da folha','material',$('front-material').value||state.params.material);material.type='hidden';
      var choice=createMaterialChoice(material,{emptyLabel:'Escolher MDF'});material.parentNode.appendChild(choice);
      var width=field('Largura da folha (mm)','width',0);width.value=Number(leaf.width)?leaf.width:'';width.placeholder='Automática';
      var via=field('Via','track',i%tracks+1);via.value=leaf.track===undefined?i%tracks+1:Number(leaf.track)+1;via.inputMode='numeric';
      field('Espessura da folha (mm)','thickness',type.value==='profile_glass'?6:type.value==='profile_mirror'?4:$('front-thickness').value||state.params.thickness);
      var profile=document.createElement('details');profile.className='item-config';var title=document.createElement('summary');title.textContent='Perfil de alumínio';profile.appendChild(title);card.appendChild(profile);
      [['profile_width','Largura (mm)',20],['profile_depth','Profundidade (mm)',25],['profile_wall','Espessura (mm)',1.5],['engagement','Encaixe (mm)',6],['finish','Acabamento','Alumínio natural']].forEach(function(item){var control=field(item[1],item[0],item[2]);profile.appendChild(control.parentNode);});
      function syncLeaf(control,group,materialRow){group.hidden=control.value==='mdf';materialRow.hidden=control.value==='profile_glass'||control.value==='profile_mirror';}
      syncLeaf(type,profile,material.parentNode);
      (function(control,group,row){control.addEventListener('change',function(){syncLeaf(control,group,row);var thickness=control.closest('details.item-config').querySelector('[data-sliding-key="thickness"]');if(control.value==='profile_glass')thickness.value='6';else if(control.value==='profile_mirror')thickness.value='4';flow.touch();});})(type,profile,material.parentNode);
      host.appendChild(card);
    }
    refreshMaterialButtons();
  }
  function fillExtraFront(f){
    f=f||{};slidingTracksManual=f.track_count!==undefined;$('drawer-type').value=f.drawer_type==='spice'?'spice':'standard';
    $('spice-levels').value=f.spice_levels||2;$('spice-runners').value=f.spice_runners||'per_level';$('spice-thickness').value=f.spice_thickness||15;
    $('spice-front-height').value=f.spice_front_height||'';$('spice-second-height').value=f.spice_second_height||'';
    $('loose-drawer-front').checked=f.include_front!==false;$('loose-drawer-runners').checked=f.include_runners!==false;$('loose-drawer-width').value=state.params.width;
    ['left','right','top','bottom'].forEach(function(side){$('drawer-advance-'+side).value=f['advance_'+side]||0;});
    $('sliding-tracks').value=f.track_count||((f.count||2)===1?1:2);$('sliding-overlap').value=f.overlap===undefined?30:f.overlap;
    $('sliding-rail-height').value=f.track_height||15;$('sliding-limit-left').value=f.sliding_limit_left||0;$('sliding-limit-right').value=f.sliding_limit_right===undefined||f.sliding_limit_right===null?'':f.sliding_limit_right;
    renderSlidingLeaves(f.sliding_leaves||[]);syncExtraFrontControls();
  }
  function syncExtraFrontControls(){
    var drawer=$('front-kind').value==='drawers',spice=drawer&&$('drawer-type').value==='spice',loose=drawer&&isLooseDrawer(),sliding=!drawer&&$('door-type').value==='sliding';
    if(sliding&&!slidingTracksManual)$('sliding-tracks').value=$('door-sliding-count').value==='1'?'1':'2';
    $('spice-settings').hidden=!spice;$('loose-drawer-settings').hidden=!loose;$('sliding-settings').hidden=!sliding;
    if(spice||loose)$('front-editor-title').textContent=(state.editingFront?'Editar ':'Configurar ')+(spice?'tempereiro':'gaveta avulsa');
    $('drawer-type').parentNode.hidden=loose;$('front-fit-field').hidden=loose;$('drawer-face-recess-field').hidden=loose||!drawer||$('front-fit').value!=='inset';
    $('front-gap').parentNode.hidden=loose;$('drawer-front-margins').hidden=loose;
    if(spice){$('drawer-runner').value='telescopic';$('front-count').value='1';}
    $('drawer-runner').disabled=spice;$('front-count-row').hidden=spice||loose||!drawer;
    $('drawer-height').parentNode.hidden=spice;$('drawer-height-difference').parentNode.hidden=spice;
    $('spice-second-height').parentNode.hidden=$('spice-levels').value!=='2';
    $('drawer-rear-clearance').parentNode.hidden=loose;
    if(sliding&&$('sliding-leaves').children.length!==Number($('door-sliding-count').value))renderSlidingLeaves(readSlidingLeaves());
    if($('choose-spice')){$('choose-spice').classList.toggle('active',spice);$('choose-spice').setAttribute('aria-pressed',String(spice));}
  }
  function readExtraFront(front,p){
    if(front.kind==='drawers'){
      if($('drawer-type').value==='spice')Object.assign(front,{drawer_type:'spice',spice_levels:$('spice-levels').value,spice_runners:$('spice-runners').value,spice_thickness:$('spice-thickness').value,spice_front_height:$('spice-front-height').value||0,spice_second_height:$('spice-second-height').value||0});
      if(isLooseDrawer()){
        p.width=M.number($('loose-drawer-width').value,'Largura externa da caixa',1,10000);p.height=M.number($('drawer-height').value,'Altura externa da caixa',1,10000);p.depth=M.number($('drawer-depth').value,'Profundidade externa da caixa',1,10000);
        front.include_front=$('loose-drawer-front').checked;front.include_runners=$('loose-drawer-runners').checked;
        ['left','right','top','bottom'].forEach(function(side){front['advance_'+side]=$('drawer-advance-'+side).value;});
      }
    }else if(front.door_type==='sliding')Object.assign(front,{sliding_version:1,track_count:$('sliding-tracks').value,overlap:$('sliding-overlap').value,track_height:$('sliding-rail-height').value,sliding_limit_left:$('sliding-limit-left').value,sliding_limit_right:$('sliding-limit-right').value||null,sliding_leaves:readSlidingLeaves()});
  }
  ['drawer-type','spice-levels','loose-drawer-front'].forEach(function(id){$(id).addEventListener('change',syncExtraFrontControls);});
  $('sliding-tracks').addEventListener('change',function(){slidingTracksManual=true;renderSlidingLeaves(readSlidingLeaves());});

  function configuredFront(kind,id,nodes,side,p){
    var pref=captureFrontPref(kind);
    if(kind==='drawers'){
      pref.box_height=M.number(pref.box_height,'Altura da caixa da gaveta',40,4000);
      pref.box_depth=M.number(pref.box_depth,'Profundidade da caixa da gaveta',100,1500);
      pref.rear_clearance=M.number(pref.rear_clearance,'Folga traseira',10,1500);
    }
    var front={id:id,kind:kind,nodes:nodes,count:pref.count,fit:pref.fit,gap:pref.gap,
      thickness:pref.thickness||p.thickness,material:pref.material||p.apparent_material||p.material,box_material:kind==='drawers'?pref.box_material||'':'',side:side||pref.side||'front',
      door_type:pref.door_type||'hinged',door_opening:pref.door_opening||'left',lift_system:pref.lift_system||'gas',
      slide_clearance:kind==='drawers'?(pref.clearance||14):13,box_height:kind==='drawers'?pref.box_height:(pref.box_height||120),box_depth:kind==='drawers'?pref.box_depth:(pref.box_depth||350),box_depth_auto:kind==='drawers'?pref.box_depth_auto!==false:true,
      box_height_difference:kind==='drawers'?pref.box_height_difference:0,
      hardware_layout_version:kind==='drawers'&&pref.runner==='telescopic'?1:0,front_height_linked:kind==='drawers',runner_height:pref.runner_height,runner_drop:pref.runner_drop,base_clearance:pref.base_clearance,front_projection:pref.front_projection,
      runner:pref.runner||'telescopic',visibility:pref.visibility||'external',recess:pref.recess||22,face_recess:kind==='drawers'?pref.face_recess:0};
    if(kind==='drawers')front.rear_clearance=pref.rear_clearance;
    ['left','right','bottom','top'].forEach(function(edge){front['gap_'+edge]=pref['gap_'+edge];});
    var previous=p.fronts.find(function(item){return item.id===id;});
    if(previous)Object.keys(p.piece_settings).forEach(function(role){
      if(role.indexOf('front:'+id+':')!==0||!M.frontPanelRole(role))return;
      var data=p.piece_settings[role];
      if(previous.material!==front.material||materialEditedFields['front-material']){delete data.material;data.edge_materials={};(data.edges||[]).forEach(function(edge){data.edge_materials[edge]=front.material;});}
      if(Number(previous.thickness)!==Number(front.thickness))delete data.thickness;
    });
    readExtraFront(front,p);return front;
  }
  function rememberApparentMaterial(p,material){if(material!==p.material||p.apparent_material)p.apparent_material=material;}
  function concludeFrontInsert(intent){
    var targets=isLooseDrawer()?[{id:'root'}]:openingTargets();if(!targets.length)throw new Error('Selecione pelo menos um vão no SketchUp.');
    if($('front-kind').value==='drawers')syncDrawerBoxMeasurements(false);
    var p=M.clone(flow.creation.baseParams),kind=$('front-kind').value,stamp=flow.creation.stamp||(flow.creation.stamp=Date.now().toString(36));
    rememberFrontPref(kind);
    if(kind==='door'){
      p.fronts.push(configuredFront(kind,'f'+stamp+'_'+p.fronts.length,targets.map(function(target){return target.id;}),'front',p));
    }else{
      targets.forEach(function(target,index){
        p.fronts.push(configuredFront(kind,'f'+stamp+'_'+p.fronts.length+'_'+index,[target.id],'front',p));
      });
    }
    if(flow.volume&&!(flow.volume.cabinet&&flow.volume.linked)){p.fronts=p.fronts.slice(-1);p.fronts[0].nodes=['root'];}else finishFrontMaterialChoice(p,intent!=='apply');
    commitInternal(p,false,intent);
  }
  function finishFrontMaterialChoice(p,offerEdgeMatch){
    var material=$('front-material').value||p.apparent_material||p.material;
    rememberApparentMaterial(p,material);
    var panels=M.layout(M.normalize(M.clone(p))).panels,edges=[];
    panels.forEach(function(piece){
      var role=piece.role,edge=role==='left'||role==='right'?'u_min':(['bottom','top','rail:front','bottom:front'].indexOf(role)>=0?'v_min':role.indexOf('split:')===0?(piece.thickness_axis===0?'u_min':'v_min'):null);
      if(edge&&piece.settings.edges.indexOf(edge)>=0&&(piece.settings.edge_materials||{})[edge]!==material)edges.push({role:role,edge:edge});
    });
    if(!offerEdgeMatch||!edges.length||!window.confirm('As frentes usam '+material+'. Alterar também as fitas frontais deste módulo?'))return;
    edges.forEach(function(entry){var data=p.piece_settings[entry.role]||{},colors=Object.assign({},data.edge_materials||{});colors[entry.edge]=material;data.edge_materials=colors;data.edge_override=true;data.edges=Array.from(new Set((data.edges||[]).concat(entry.edge)));p.piece_settings[entry.role]=data;});
  }
  $('choose-door').addEventListener('click',function(){startInsertTool('door');});
  $('choose-drawer').addEventListener('click',function(){startInsertTool('drawers');});
  $('choose-spice').addEventListener('click',function(){startInsertTool('drawers');$('drawer-type').value='spice';syncExtraFrontControls();});
  $('config-door').addEventListener('click',function(){chooseFront('door');});
  $('config-drawer').addEventListener('click',function(){chooseFront('drawers');});
  $('door-type').addEventListener('change',function(){syncDoorControls();refreshDoorTargets();});
  $('door-hinged-mode').addEventListener('change',syncDoorControls);
  $('door-lift-opening').addEventListener('change',syncDoorControls);
  $('door-lift-system').addEventListener('change',syncDoorControls);
  $('door-sliding-count').addEventListener('change',syncDoorControls);
  $('drawer-visibility').addEventListener('change',function(){drawerVisibility();syncDrawerBoxMeasurements(false);});
  $('drawer-box-material-inherit').addEventListener('click',function(){$('drawer-box-material').value='';delete materialEditedFields['drawer-box-material'];flow.touch();refreshMaterialButtons();});
  $('front-count').addEventListener('input',function(){syncDrawerBoxMeasurements(true);});
  $('front-fit').addEventListener('change',function(){loadDrawerGapDefaults();drawerVisibility();syncDrawerBoxMeasurements(false);refreshDoorTargets();});
  ['front-gap','front-gap-top','front-gap-bottom','front-gap-left','front-gap-right','drawer-front-projection'].forEach(function(id){
    $(id).addEventListener('input',function(){syncDrawerBoxMeasurements(false);});
  });
  $('front-thickness').addEventListener('change',function(){syncDrawerBoxMeasurements(false);});
  $('drawer-recess').addEventListener('input',function(){syncDrawerBoxMeasurements(false);});
  $('drawer-face-recess').addEventListener('input',function(){syncDrawerBoxMeasurements(false);});
  $('drawer-rear-clearance').addEventListener('input',function(){syncDrawerBoxMeasurements(false);});
  $('drawer-depth').addEventListener('input',function(){drawerDepthManual=true;});
  $('drawer-height').addEventListener('input',function(){drawerHeightManual=true;drawerHeightRequested=this.value;});
  $('drawer-height').addEventListener('change',function(){syncDrawerBoxMeasurements(false);});
  $('drawer-runner-drop').addEventListener('input',function(){ $('drawer-base-clearance').value=this.value;syncDrawerBoxMeasurements(false); });
  $('drawer-base-clearance').addEventListener('input',function(){ $('drawer-runner-drop').value=this.value;syncDrawerBoxMeasurements(false); });
  $('drawer-runner').addEventListener('change',function(){
    $('drawer-clearance').value=this.value==='telescopic'?'14':'';
    drawerVisibility();syncDrawerBoxMeasurements(false);refreshPins();
  });
  $('change-front-target').addEventListener('click',function(){
    if(!state.editingFront||state.busy)return;
    editingFrontNodes=[];frontTargetChanging=true;flow.openings=[];flow.opening=null;
    drawerOpeningKey='';
    $('front-target-text').textContent='Clique no vão no SketchUp.';
    request('select_openings',[$('front-kind').value==='drawers'?'drawer_edit':'door']);
  });
  $('add-front').addEventListener('click',function(event){
    try {
      if(insertSessionActive()){concludeFrontInsert(editorIntent(event));return;}
      if($('front-kind').value==='drawers')syncDrawerBoxMeasurements(false);
      var p=readForm(),kind=$('front-kind').value;
      var nodes=state.editingFront?editingFrontNodes:[state.selected];
      if(!nodes||!nodes.length)throw new Error('Selecione o vão no SketchUp.');
      if(kind==='drawers'&&nodes.length!==1)throw new Error('Escolha um único vão para este conjunto de gavetas.');
      var front=configuredFront(kind,state.editingFront||'f'+Date.now().toString(36)+'_'+p.fronts.length,nodes,$('front-side').value,p);
      rememberFrontPref(kind);
      if(state.editingFront)p.fronts=p.fronts.map(function(f){return f.id===state.editingFront?front:f;});else p.fronts.push(front);
      finishFrontMaterialChoice(p,editorIntent(event)!=='apply');
      commitInternal(p,false,editorIntent(event));
    }catch(error){message(error.message,'error');}
  });
  function resetFrontEdit(){if(insertSessionActive()){cancelInsertSession();return;}clearInternalEditors();updateChrome();}
  $('cancel-front-edit').addEventListener('click',resetFrontEdit);

  function beginSimpleInsert(kind){
    var originScroll=document.querySelector('main').scrollTop;
    if(volumeContext&&['baseboard','crown','cladding'].indexOf(kind)>=0){beginVolumeInsert(kind);return;}
    if(state.busy||state.dirty||!state.target||state.conflict)return;
    if(activePaint)endPaintSession();clearInternalEditors();flow.start(kind,'create',{baseParams:M.clone(state.params),originScroll:originScroll,selecting:['door','drawers','shelf','divider'].indexOf(kind)>=0});setActiveInsertTool(kind);
    if(kind==='cladding')openCladdingEditor(null);
    else if(kind==='baseboard'||kind==='crown')openTrimEditor(kind,null);
    else if(kind==='accessory')openAccessoryEditor(null);
    updateChrome();document.querySelector('main').scrollTop=0;
  }

  function claddingForSide(side){
    return (state.params.claddings||[]).filter(function(item){return item.side===side;})[0]||null;
  }
  function claddingPref(){
    return {front:pinNumber('cladding','cladding-front',20),rear:pinNumber('cladding','cladding-rear',0),
      rail_depth:pinNumber('cladding','cladding-rail-depth',70)};
  }
  var claddingSharedChanged={};
  function syncCladdingControls(){
    var sides=['left','right','top','bottom'].filter(function(side){return $('cladding-'+side).checked;});
    var modes=sides.map(function(side){return $('cladding-mode-'+side).value;});
    $('cladding-vertical-extensions').hidden=sides.indexOf('left')<0&&sides.indexOf('right')<0;
    $('cladding-layers-field').hidden=modes.indexOf('thickened')<0;
    $('cladding-rail-depth-field').hidden=modes.every(function(mode){return mode==='panel';});
    $('cladding-rear-field').hidden=modes.length>0&&modes.every(function(mode){return mode==='rail';});
    $('cladding-build-section').hidden=sides.length===0;
    ['left','right','top','bottom'].forEach(function(side){
      var position=document.querySelector('[data-cladding-side="'+side+'"]');
      position.classList.toggle('selected',sides.indexOf(side)>=0);
      position.classList.toggle('unavailable',$('cladding-'+side).disabled);
      document.querySelector('[data-cladding-settings="'+side+'"]').hidden=sides.indexOf(side)<0;
    });
  }
  function loadCladdingSide(side){
    var p=state.params,all=side==='all',item=all?(p.claddings||[])[0]:side?claddingForSide(side):null,pref=claddingPref();
    ['left','right','top','bottom'].forEach(function(value){
      var existing=claddingForSide(value);
      $('cladding-'+value).checked=all?!!existing:value===side;
      $('cladding-'+value).disabled=!all&&!!editingCladding&&value!==editingCladding||!editingCladding&&!!existing;
      if(editingCladding&&existing)$('cladding-'+value).disabled=true;
      $('cladding-mode-'+value).value=existing&&all?existing.mode:value===side&&item&&item.mode||'panel';
    });
    $('cladding-layers').value=String(item&&item.layers||1);
    $('cladding-rail-depth').value=item&&item.rail_depth||pref.rail_depth;
    setValue('cladding-thickness',item?item.thickness:p.thickness);
    $('cladding-material').value=item?item.material:(p.apparent_material||p.material);
    setValue('cladding-extend-top',item&&item.extend_top||0);setValue('cladding-extend-bottom',item&&item.extend_bottom||0);
    setValue('cladding-front',item?item.front:pref.front);setValue('cladding-rear',item?item.rear:pref.rear);
    $('cladding-overlap-top').value=p.cladding_overlap&&p.cladding_overlap.top||'horizontal';
    $('cladding-overlap-bottom').value=p.cladding_overlap&&p.cladding_overlap.bottom||'horizontal';
    $('cladding-edit-hint').hidden=!all;
    syncCladdingControls();refreshMaterialButtons();
  }
  function openCladdingEditor(side){
    editingCladding=side||null;
    claddingSharedChanged={};
    loadCladdingSide(side||null);
    $('cladding-editor-title').textContent=side?'Editar tamponamento':'Configurar tamponamento';
    $('add-cladding').textContent=side?'Concluir edição':'Concluir inserção';
    $('cancel-cladding').textContent=side?'Cancelar edição':'Cancelar inserção';
    $('cladding-editor').hidden=false;updateChrome();
  }
  function claddingEditorItem(p,side){
    var previous=(p.claddings||[]).find(function(value){return value.side===side;});
    var mode=$('cladding-mode-'+side).value,item=previous?M.clone(previous):{side:side},modeChanged=!previous||previous.mode!==mode;
    item.mode=mode;
    ['top','bottom'].forEach(function(edge){var key='extend_'+edge;if(!previous||claddingSharedChanged[key])item[key]=M.number($('cladding-extend-'+edge).value,'Ajuste das laterais '+(edge==='top'?'no topo':'na base'),-4000,4000);});
    if(!previous||claddingSharedChanged.thickness)item.thickness=M.number($('cladding-thickness').value,'Espessura do tamponamento',6,40);
    if(!previous||claddingSharedChanged.material)item.material=$('cladding-material').value||p.apparent_material||p.material;
    if(!previous||claddingSharedChanged.front)item.front=M.number($('cladding-front').value,'Avanço na frente',0,300);
    if(mode==='rail')item.rear=0;
    else if(!previous||claddingSharedChanged.rear)item.rear=M.number($('cladding-rear').value,'Avanço atrás',0,300);
    if(mode!=='panel'){
      if(modeChanged||claddingSharedChanged.rail_depth)item.rail_depth=M.number($('cladding-rail-depth').value,'Profundidade da régua',10,1500);
    }else if(modeChanged)delete item.rail_depth;
    if(mode==='thickened'){
      if(modeChanged||claddingSharedChanged.layers)item.layers=M.number($('cladding-layers').value,'Camadas de engrosso',1,6);
    }else if(modeChanged)delete item.layers;
    return item;
  }
  function preserveCladdingPieceSettings(p,item,previous){
    var base='cladding:'+item.side,roles=item.mode==='rail'?[base+':front:1']:[base];
    if(item.mode==='thickened')for(var i=1;i<=item.layers;i++)roles.push(base+':front:'+i,base+':rear:'+i);
    Object.keys(p.piece_settings).forEach(function(role){if((role===base||role.indexOf(base+':')===0)&&roles.indexOf(role)<0)delete p.piece_settings[role];});
    roles.forEach(function(role){
      var data=M.clone(p.piece_settings[role]||{});
      data.thickness=item.thickness;
      if(role.indexOf(':rear:')>=0){
        if(!data.material||data.material==='Retalho'||previous&&data.material===previous.material)data.material=p.hidden_material||'Retalho';
      }else data.material=item.material;
      delete data.adjustment;p.piece_settings[role]=data;
    });
  }
  function renderCladdings(){
    var list=$('cladding-list');list.textContent='';
    var items=state.params.claddings||[];if(!items.length)return;
    var row=document.createElement('div'),text=document.createElement('span'),edit=document.createElement('button'),remove=document.createElement('button'),detail=document.createElement('small');
    row.className='internal-row';text.textContent='Tamponamentos';
    var names={left:'esquerdo',right:'direito',top:'superior',bottom:'inferior'};
    detail.textContent=items.length+' '+(items.length===1?'posição':'posições')+' · '+items.map(function(item){return names[item.side];}).join(', ');
    text.appendChild(detail);
    edit.className='small-button';edit.textContent='Editar';edit.addEventListener('click',function(){if(state.busy)return;clearInternalEditors();setActiveInsertTool(null);openCladdingEditor('all');});
    remove.className='small-button danger';remove.textContent='Remover';remove.setAttribute('aria-label','Remover todos os tamponamentos');
    remove.addEventListener('click',function(){removeInserted('cladding','all');});
    row.appendChild(text);row.appendChild(edit);row.appendChild(remove);list.appendChild(row);
    var management=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Gerenciar posições';management.appendChild(summary);
    items.forEach(function(item){var entry=document.createElement('div'),label=document.createElement('span'),removeSide=document.createElement('button');entry.className='internal-row';label.textContent='Tamponamento '+names[item.side];removeSide.type='button';removeSide.className='small-button danger';removeSide.textContent='Remover';removeSide.setAttribute('aria-label','Remover tamponamento '+names[item.side]);removeSide.onclick=function(){removeInserted('cladding',item.side);};entry.appendChild(label);entry.appendChild(removeSide);management.appendChild(entry);});list.appendChild(management);
  }
  [['cladding-thickness','thickness'],['cladding-layers','layers'],['cladding-rail-depth','rail_depth'],
    ['cladding-front','front'],['cladding-rear','rear']].forEach(function(entry){
    $(entry[0]).addEventListener('input',function(){claddingSharedChanged[entry[1]]=true;});
    $(entry[0]).addEventListener('change',function(){claddingSharedChanged[entry[1]]=true;});
  });
  ['left','right','top','bottom'].forEach(function(side){
    $('cladding-'+side).addEventListener('change',syncCladdingControls);
    $('cladding-mode-'+side).addEventListener('change',syncCladdingControls);
  });
  ['top','bottom'].forEach(function(edge){$('cladding-extend-'+edge).addEventListener('input',function(){claddingSharedChanged['extend_'+edge]=true;});});
  $('cladding-layers').addEventListener('change',syncCladdingControls);
  $('add-cladding').addEventListener('click',function(event){try{
    var p=insertSessionActive()?M.clone(flow.creation.baseParams):readForm(),oldSide=editingCladding;
    var sides=['left','right','top','bottom'].filter(function(side){return $('cladding-'+side).checked;});
    if(!sides.length&&oldSide!=='all')throw new Error('Selecione ao menos uma posição para o tamponamento.');
    p.cladding_overlap={top:$('cladding-overlap-top').value,bottom:$('cladding-overlap-bottom').value};
    if(oldSide==='all'){
      var removed=p.claddings.filter(function(item){return sides.indexOf(item.side)<0;});
      p.claddings=p.claddings.filter(function(item){return sides.indexOf(item.side)>=0;});
      removed.forEach(function(item){var base='cladding:'+item.side;
        Object.keys(p.piece_settings).forEach(function(role){if(role===base||role.indexOf(base+':')===0)delete p.piece_settings[role];});});
    }
    sides.forEach(function(side){
      var previous=p.claddings.find(function(v){return v.side===side;}),item=claddingEditorItem(p,side),index=p.claddings.findIndex(function(v){return v.side===side;});
      if(index>=0&&oldSide!=='all'&&side!==oldSide)throw new Error('Já existe um tamponamento nesta posição. Edite o existente.');
      if(index>=0)p.claddings[index]=item;else p.claddings.push(item);
      if(!previous||JSON.stringify(item)!==JSON.stringify(previous))preserveCladdingPieceSettings(p,item,previous);
    });
    if(sides.length&&$('cladding-material').value)rememberApparentMaterial(p,$('cladding-material').value);
    commitInternal(p,false,editorIntent(event));
  }catch(error){message(error.message,'error');}});
  $('cancel-cladding').addEventListener('click',function(){if(insertSessionActive())cancelInsertSession();else{clearInternalEditors();updateChrome();}});

  function trimForKind(kind){return (state.params.trims||[]).filter(function(item){return item.kind===kind;})[0]||null;}
  function restoreTrimEditorHome(){
    trimEditorHome.appendChild($('trim-editor'));$('trim-editor').hidden=true;
    if($('library-baseboard-editor'))$('library-baseboard-editor').hidden=true;
    $('library-content').hidden=false;standaloneTrim=null;
  }
  function openStandaloneBaseboard(entry){
    if(state.busy)return;
    rememberDraft();clearInternalEditors();
    var params=M.normalize(entry.params),holder=$('library-baseboard-editor');
    if(!holder){holder=document.createElement('section');holder.id='library-baseboard-editor';$('tab-library').appendChild(holder);}
    standaloneTrim={params:params};$('library-content').hidden=true;holder.hidden=false;holder.appendChild($('trim-editor'));
    openTrimEditor('baseboard',params.trims[0],params);
    $('trim-editor-title').textContent='Configurar rodapé avulso';$('save-trim').textContent='Criar e posicionar';$('cancel-trim').textContent='Voltar';
    updateChrome();document.querySelector('main').scrollTop=0;
  }
  function openTrimEditor(kind,item,recipe){
    var p=recipe||state.params,avulso=!p.volume_bound&&(p.module_family==='baseboard'||p.module_family==='functional'||flow.volume&&!flow.volume.linked);
    editingTrim=item?kind:null;$('trim-kind').value=kind;
    $('trim-editor-title').textContent=(item?'Editar ':'Configurar ')+(kind==='baseboard'?'rodapé':'rodateto')+(avulso?' avulso':'');
    $('trim-width-label').textContent='Largura do '+(kind==='baseboard'?'rodapé':'rodateto')+' (mm)';$('trim-depth-label').textContent='Profundidade do '+(kind==='baseboard'?'rodapé':'rodateto')+' (mm)';
    $('trim-dimensions').hidden=!avulso;$('trim-recesses').hidden=avulso;$('trim-coverage').hidden=avulso||!M.hasSideCladdings(p);
    setValue('trim-width',p.width);setValue('trim-depth',p.depth);
    $('trim-material-label').textContent='MDF do acabamento';
    $('trim-construction-title').textContent=kind==='baseboard'?'Estrutura oculta':'Espessura';
    setValue('trim-height',item?item.height:pinNumber(kind,'trim-height',100));
    setValue('trim-setback',item?item.setback:pinNumber(kind,'trim-setback',kind==='baseboard'?50:0));
    setValue('trim-foot-height',item?item.foot_height:pinNumber(kind,'trim-foot-height',15));
    setValue('trim-setback-back',item?item.setback_back:pinNumber(kind,'trim-setback-back',0));
    setValue('trim-setback-left',item?item.setback_left:pinNumber(kind,'trim-setback-left',0));
    setValue('trim-setback-right',item?item.setback_right:pinNumber(kind,'trim-setback-right',0));
    setValue('trim-max-opening',item?item.max_opening:pinNumber(kind,'trim-max-opening',600));
    document.querySelectorAll('.trim-baseboard-field').forEach(function(field){field.hidden=kind!=='baseboard';});
    document.querySelectorAll('.trim-crown-field').forEach(function(field){field.hidden=kind!=='crown';});
    ['left','right','back'].forEach(function(side){
      $('trim-finish-'+side).checked=!!(item&&item['finish_'+side]);
      $('trim-crown-'+side).checked=!!(item&&item['crown_'+side]);
      setValue('trim-crown-setback-'+side,item&&item['setback_'+side]!==undefined?item['setback_'+side]:pinNumber(kind,'trim-crown-setback-'+side,0));
    });
    syncCrownSetbacks();
    setValue('trim-thickness',item?item.thickness:p.thickness);$('trim-material').value=item?item.material:(kind==='baseboard'?p.apparent_material||p.material:p.material);
    $('trim-frame-material').value=item&&item.frame_material||p.hidden_material||'Retalho';
    $('trim-cover-cladding-label').textContent='Tamponamento cobre o '+(kind==='baseboard'?'rodapé':'rodateto');
    var coverage=$('trim-cover-cladding');coverage.indeterminate=false;coverage.checked=true;
    if(item&&item.cover_cladding!==undefined)coverage.checked=item.cover_cladding;
    else if(item){
      var key=kind==='baseboard'?'cover_baseboard':'cover_crown';
      var legacy=(p.claddings||[]).filter(function(value){return value.side==='left'||value.side==='right';})
        .map(function(value){return value[key]!==false;});
      if(legacy.length){
        var all=legacy.every(Boolean),some=legacy.some(Boolean);
        coverage.checked=some;coverage.indeterminate=some&&!all;
      }
    }
    $('save-trim').textContent=item?'Concluir edição':'Concluir inserção';$('cancel-trim').textContent=item?'Cancelar edição':'Cancelar inserção';
    $('trim-editor').hidden=false;refreshMaterialButtons();updateChrome();
    syncTrimSideSetbacks();
  }
  function syncTrimSideSetbacks(){
    $('trim-side-setbacks').hidden=$('trim-kind').value!=='baseboard'||(!$('trim-coverage').hidden&&$('trim-cover-cladding').checked);
    $('trim-coverage-family').hidden=$('trim-coverage').hidden;
  }
  $('trim-cover-cladding').addEventListener('change',syncTrimSideSetbacks);
  function syncCrownSetbacks(){['left','right','back'].forEach(function(side){$('trim-crown-setback-'+side+'-field').hidden=!$('trim-crown-'+side).checked;});}
  ['left','right','back'].forEach(function(side){$('trim-crown-'+side).addEventListener('change',syncCrownSetbacks);});
  function trimEditorItem(p){
    var item={kind:$('trim-kind').value,height:M.number($('trim-height').value,'Altura',20,1000),
      setback:M.number($('trim-setback').value,'Recuo da frente',0,500),
      thickness:M.number($('trim-thickness').value,'Espessura',6,40),material:$('trim-material').value||p.material};
    if(!$('trim-cover-cladding').indeterminate)item.cover_cladding=$('trim-cover-cladding').checked;
    if(item.kind==='baseboard'){
      item.structure_version=1;
      item.foot_height=M.number($('trim-foot-height').value,'Altura da sapata',1,item.height-10);
      item.setback_back=M.number($('trim-setback-back').value,'Recuo traseiro',0,500);
      item.setback_left=M.number($('trim-setback-left').value,'Recuo esquerdo',0,500);
      item.setback_right=M.number($('trim-setback-right').value,'Recuo direito',0,500);
      item.max_opening=M.number($('trim-max-opening').value,'Largura máxima entre vãos',100,4000);
      var prior=(p.trims||[]).find(function(value){return value.kind==='baseboard';});
      item.frame_material=$('trim-frame-material').value||prior&&prior.frame_material||p.hidden_material||'Retalho';
      ['left','right','back'].forEach(function(side){item['finish_'+side]=$('trim-finish-'+side).checked;});
    }else{
      ['left','right','back'].forEach(function(side){
        item['crown_'+side]=$('trim-crown-'+side).checked;
        item['setback_'+side]=M.number($('trim-crown-setback-'+side).value,'Recuo '+({left:'esquerdo',right:'direito',back:'traseiro'}[side]),0,500);
      });
    }
    if(!p.volume_bound&&(p.module_family==='baseboard'||p.module_family==='functional'||flow.volume&&!flow.volume.linked)){
      item.setback=item.setback_back=item.setback_left=item.setback_right=0;item.cover_cladding=false;
      var label=item.kind==='baseboard'?'rodapé':'rodateto';
      p.width=M.number($('trim-width').value,'Largura do '+label,100,4000);p.depth=M.number($('trim-depth').value,'Profundidade do '+label,80,1500);
      p.height=item.height;p.thickness=item.thickness;p.material=item.material;if(item.frame_material)p.hidden_material=item.frame_material;
    }
    return item;
  }
  function renderTrims(){
    var list=$('trim-list');list.textContent='';
    (state.params.trims||[]).forEach(function(item){
      var row=document.createElement('div'),text=document.createElement('span'),edit=document.createElement('button'),remove=document.createElement('button'),detail=document.createElement('small');
      row.className='internal-row';text.textContent=item.kind==='baseboard'?'Rodapé':'Rodateto';
      detail.textContent=format(item.height)+' mm · '+format(item.thickness)+' mm · '+item.material;text.appendChild(detail);
      edit.className='small-button';edit.textContent='Editar';edit.addEventListener('click',function(){if(state.busy)return;clearInternalEditors();setActiveInsertTool(null);openTrimEditor(item.kind,item);});
      remove.className='small-button danger';remove.textContent='Remover';remove.addEventListener('click',function(){removeInserted('trim',item.kind);});
      remove.hidden=state.params.module_family==='baseboard';
      row.appendChild(text);row.appendChild(edit);row.appendChild(remove);list.appendChild(row);
    });
  }
  $('save-trim').addEventListener('click',function(event){try{
    var creating=!!standaloneTrim,p=creating?M.clone(standaloneTrim.params):insertSessionActive()?M.clone(flow.creation.baseParams):readForm(),item=trimEditorItem(p),kind=item.kind;
    var previous=(p.trims||[]).find(function(value){return value.kind===kind;});
    if(previous)Object.keys(p.piece_settings).forEach(function(role){
      if(role!=='trim:'+kind&&role.indexOf('trim:'+kind+':')!==0)return;
      var data=p.piece_settings[role],hiddenFrame=kind==='baseboard'&&/^trim:baseboard:(frame|flat):/.test(role);
      var oldMaterial=hiddenFrame?previous.frame_material:previous.material;
      var newMaterial=hiddenFrame?item.frame_material:item.material;
      var materialField=hiddenFrame?'trim-frame-material':'trim-material';
      if(oldMaterial!==newMaterial||materialEditedFields[materialField]){delete data.material;data.edge_materials={};(data.edges||[]).forEach(function(edge){data.edge_materials[edge]=newMaterial;});}
      if(Number(previous.thickness)!==Number(item.thickness))delete data.thickness;
    });
    if(kind==='baseboard'){
      rememberApparentMaterial(p,item.material);
      p.excluded_pieces=(p.excluded_pieces||[]).filter(function(role){return !['left','right','back'].some(function(side){return item['finish_'+side]&&role==='trim:baseboard:'+side;});});
    }
    p.trims=(p.trims||[]).filter(function(v){return v.kind!==kind;});p.trims.push(item);
    if(creating){p=M.normalize(p);restoreTrimEditorHome();clearInternalEditors();request('insert_standalone_baseboard',[p]);return;}
    commitInternal(p,false,editorIntent(event));
  }catch(error){message(error.message,'error');}});
  $('cancel-trim').addEventListener('click',function(){if(standaloneTrim){clearInternalEditors();updateChrome();}else if(insertSessionActive())cancelInsertSession();else{clearInternalEditors();updateChrome();}});

  var accessoryLabels={wirework:'Aramados',outlets:'Tomadas',cable_grommet:'Passa-fios',hardware:'Ferragens avulsas',casters:'Rodízios',glides:'Sapatas',feet:'Pés / pezinhos',hangers:'Cabideiros',supports:'Suportes',other:'Outros'};
  function openAccessoryEditor(item){
    editingAccessory=item?item.id:null;
    $('accessory-editor').querySelector('h3').textContent=item?'Editar acessório':'Configurar acessório';
    $('accessory-family').value=item?item.family:'wirework';$('accessory-name').value=item?item.name:'';$('accessory-quantity').value=item?item.quantity:1;
    $('save-accessory').textContent=item?'Concluir edição':'Concluir inserção';$('cancel-accessory').textContent=item?'Cancelar edição':'Cancelar inserção';
    $('accessory-editor').hidden=false;updateChrome();
  }
  function renderAccessories(){
    var list=$('accessory-list');list.textContent='';
    (state.params.accessories||[]).forEach(function(item){
      var row=document.createElement('div'),text=document.createElement('span'),edit=document.createElement('button'),remove=document.createElement('button'),detail=document.createElement('small');
      row.className='internal-row';text.textContent=item.name;detail.textContent=accessoryLabels[item.family]+' · '+item.quantity+' un.';text.appendChild(detail);
      edit.className='small-button';edit.textContent='Editar';edit.addEventListener('click',function(){if(state.busy)return;clearInternalEditors();setActiveInsertTool(null);openAccessoryEditor(item);});
      remove.className='small-button danger';remove.textContent='Remover';remove.addEventListener('click',function(){removeInserted('accessory',item.id);});
      row.appendChild(text);row.appendChild(edit);row.appendChild(remove);list.appendChild(row);
    });
  }
  $('save-accessory').addEventListener('click',function(event){try{
    var p=insertSessionActive()?M.clone(flow.creation.baseParams):readForm(),name=$('accessory-name').value.trim();
    if(!name)throw new Error('Informe a descrição do acessório.');
    var quantity=M.number($('accessory-quantity').value,'Quantidade',1,999);if(quantity!==Math.floor(quantity))throw new Error('Quantidade deve ser inteira.');
    var id=editingAccessory||(insertSessionActive()?(flow.creation.accessoryId||(flow.creation.accessoryId='a'+Date.now().toString(36)+'_'+p.accessories.length)):'a'+Date.now().toString(36)+'_'+p.accessories.length);
    var item={id:id,family:$('accessory-family').value,name:name,quantity:quantity};
    p.accessories=(p.accessories||[]).filter(function(v){return v.id!==id;});p.accessories.push(item);
    commitInternal(p,false,editorIntent(event));
  }catch(error){message(error.message,'error');}});
  $('cancel-accessory').addEventListener('click',function(){if(insertSessionActive())cancelInsertSession();else{clearInternalEditors();updateChrome();}});

  $('add-cladding-tool').addEventListener('click',function(){beginSimpleInsert('cladding');});
  $('add-baseboard').addEventListener('click',function(){beginSimpleInsert('baseboard');});
  $('add-crown').addEventListener('click',function(){beginSimpleInsert('crown');});
  $('add-accessory').addEventListener('click',function(){beginSimpleInsert('accessory');});

  $('select-openings').addEventListener('click',function(){setActiveInsertTool(null);request('select_openings');});
  $('clear-opening').addEventListener('click',function(){flow.opening=null;flow.openings=[];setActiveInsertTool(null);updateChrome();request('clear_opening');});
  function receiveOpening(value,values){
    if(flow.current&&flow.current.pending)return;
    flow.openings=(values&&values.length?values:(value?[value]:[])).slice();
    flow.opening=flow.openings[0]||null;
    if(flow.opening){
      state.selected=flow.opening.id;
      if(state.editingFront&&frontTargetChanging){editingFrontNodes=flow.openings.map(function(item){return item.id;});$('front-side').value='front';$('front-target-text').textContent=editingFrontNodes.length+' '+(editingFrontNodes.length===1?'vão vinculado':'vãos vinculados');}
      $('front-details').open=true;renderPreview();
    }
    syncDrawerBoxMeasurements(false);
    updateInsertTargetCount();
  }
  function selectedPiece() {return M.layout(state.params).panels.filter(function(p){return p.role===state.pieceRole;})[0];}
  function selectedExtra(){return state.extras.filter(function(e){return 'extra:'+e.id===state.pieceRole;})[0];}
  function cutAxes(size,axis,data){
    var uv=[0,1,2].filter(function(i){return i!==axis;}),orientation=data&&data.cut_orientation;
    if(data&&data.construction_type==='glass')return uv;
    if(!orientation)orientation=size[uv[0]]>=size[uv[1]]?'u_length':'v_length';
    return orientation==='v_length'?[uv[1],uv[0]]:uv;
  }
  function extraPieceDetail(piece){
    var size=piece.size||[],axis=piece.thickness_axis;
    if(size.length!==3||axis===undefined)return 'Incluída no módulo';
    var axes=cutAxes(size,axis,piece.settings);
    return [size[axes[0]],size[axes[1]],size[axis]].map(format).join(' × ')+' mm';
  }
  function appendPieceEntry(list,piece){
    var row=document.createElement('button'),label=document.createElement('span'),detail=document.createElement('small'),arrow=document.createElement('span');
    row.type='button';row.className='piece-entry';row.setAttribute('aria-label','Editar '+piece.name+', '+piece.detail);
    label.className='piece-entry-label';label.textContent=piece.name;
    detail.textContent=piece.detail;label.appendChild(detail);
    arrow.className='piece-entry-arrow';arrow.textContent='›';arrow.setAttribute('aria-hidden','true');
    row.appendChild(label);row.appendChild(arrow);
    row.addEventListener('click',function(){openModulePieceEditor(piece.role);});
    var holder=document.createElement('div');holder.className='plany-managed-item';holder.appendChild(row);
    [['Tornar peça avulsa','detach_piece'],['Remover peça','delete_piece']].forEach(function(action){
      var b=document.createElement('button'),remove=action[1]==='delete_piece';
      b.type='button';b.className='plany-piece-action'+(remove?' is-danger':'');
      b.title=action[0];b.setAttribute('aria-label',action[0]+': '+piece.name);
      // Same 24px stroke-icon family: separated panels / trash, not emoji.
      b.innerHTML=remove?
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6.5 7l.8 13h9.4l.8-13M10 11v6M14 11v6"/></svg>':
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4" width="7" height="7" rx="1"/><rect x="2.5" y="14" width="7" height="7" rx="1"/><path d="M11.5 12h4m-2.5-2.5 2.5 2.5-2.5 2.5"/><rect x="17" y="9.5" width="5" height="6" rx="1"/></svg>';
      b.addEventListener('click',function(event){
        event.stopPropagation();
        if(state.dirty){message('Conclua ou cancele a edição do módulo antes de gerenciar a peça.','error');return;}
        request(action[1],[state.target,piece.role]);
      });
      holder.appendChild(b);
    });
    list.appendChild(holder);
  }
  function appendPieceHeading(list,title,count){
    var heading=document.createElement('h3'),label=document.createElement('span'),quantity=document.createElement('span');
    heading.className='piece-group-title';label.textContent=title;
    quantity.className='piece-group-count';quantity.textContent=count+' '+(count===1?'peça':'peças');
    heading.appendChild(label);heading.appendChild(quantity);list.appendChild(heading);
  }
  function renderPieces() {
    var pieces=M.layout(state.params).panels;
    if(state.params.module_family==='custom'){
      var customList=$('module-pieces'),mdfPieces=state.extras.slice();
      customList.textContent='';
      if(!mdfPieces.some(function(p){return 'extra:'+p.id===state.pieceRole;})){state.pieceRole=mdfPieces.length?'extra:'+mdfPieces[0].id:'';pieceEditorOpen=false;}
      $('piece-role').value=state.pieceRole;
      mdfPieces.forEach(function(p){
        appendPieceEntry(customList,{role:'extra:'+p.id,name:p.name,detail:extraPieceDetail(p)});
      });
      $('module-piece-count').textContent=countText(mdfPieces.length,'peça','peças');
      if($('footer-piece-count'))$('footer-piece-count').textContent=mdfPieces.length;
      if($('pieces-workspace-count'))$('pieces-workspace-count').textContent=countText(mdfPieces.length,'peça','peças');
      if(pieceEditorOpen)fillPiece();return;
    }
    var valid=pieces.some(function(p){return p.role===state.pieceRole;})||state.extras.some(function(p){return 'extra:'+p.id===state.pieceRole;});
    if(!valid){pieceEditorOpen=false;state.pieceRole=pieces.length?pieces[0].role:state.extras.length?'extra:'+state.extras[0].id:'';}
    $('piece-role').value=state.pieceRole;
    var groups={'Caixaria':[],'Prateleiras e divisórias':[],'Portas e gavetas':[],'Tamponamentos e acabamentos':[],'Peças adicionais':[]},list=$('module-pieces');list.textContent='';
    pieces.forEach(function(p){
      var group=p.role.indexOf('split:')===0?'Prateleiras e divisórias':p.role.indexOf('front:')===0?'Portas e gavetas':
        (p.role.indexOf('cladding:')===0||p.role.indexOf('trim:')===0)?'Tamponamentos e acabamentos':'Caixaria';
      var axes=cutAxes(p.size,p.thickness_axis,p.settings);
      groups[group].push({role:p.role,name:p.role.indexOf('split:')===0?divisionName(p.role):p.name,detail:[p.size[axes[0]],p.size[axes[1]],p.size[p.thickness_axis]].map(format).join(' × ')+' mm'});
    });
    state.extras.forEach(function(p){groups['Peças adicionais'].push({role:'extra:'+p.id,name:p.name,detail:extraPieceDetail(p)});});
    var totalPieces=pieces.length+state.extras.length;
    $('module-piece-count').textContent=countText(totalPieces,'peça','peças');
    if($('footer-piece-count'))$('footer-piece-count').textContent=totalPieces;
    if($('pieces-workspace-count'))$('pieces-workspace-count').textContent=countText(totalPieces,'peça','peças');
    Object.keys(groups).forEach(function(title){if(!groups[title].length)return;
      appendPieceHeading(list,title,groups[title].length);
      groups[title].forEach(function(p){appendPieceEntry(list,p);});
    });
    if(pieceEditorOpen)fillPiece();
  }
  function fillPiece() {
    var p=selectedPiece(),extra=selectedExtra(),data=p?p.settings:extra?extra.settings:M.normalizePiece({});
    var material=data.material||(p&&p.material)||(extra&&extra.material)||'Branco TX';
    $('piece-role').value=state.pieceRole;
    fillPieceElevation('piece',null);
    $('piece-name').value=p?(data.name||p.name):(extra?extra.name:'');
    $('piece-name').disabled=!(p||extra);
    setValue('piece-thickness',(p||extra)?(p||extra).size[(p||extra).thickness_axis]:data.thickness);$('piece-thickness').disabled=!(p||extra);
    $('piece-material').value=material;$('piece-material').disabled=(data.construction_type||(p&&p.family)||(extra&&extra.family)||'mdf')!=='mdf';$('piece-grain').value=materialGrain(material,data.grain);
    $('piece-tape').value=String(data.tape_thickness).replace('.',',');$('piece-decrement').checked=data.edge_decrement;pieceEdges=data.edges.slice();
    if(p){
      var uv=[0,1,2].filter(function(i){return i!==p.thickness_axis;});
      pieceEditorAxes=cutAxes(p.size,p.thickness_axis,data);
      setValue('piece-u',measureText(p.size[pieceEditorAxes[0]]));setValue('piece-v',measureText(p.size[pieceEditorAxes[1]]));
      $('piece-u').disabled=$('piece-v').disabled=false;
    }else{
      pieceEditorAxes=extra&&extra.size?cutAxes(extra.size,extra.thickness_axis,extra.settings):[0,1];
      setValue('piece-u',extra&&extra.size?measureText(extra.size[pieceEditorAxes[0]]):'');
      setValue('piece-v',extra&&extra.size?measureText(extra.size[pieceEditorAxes[1]]):'');
      $('piece-u').disabled=$('piece-v').disabled=!extra;
    }
    var node=p&&state.pieceRole.indexOf('split:')===0?M.find(state.params,state.pieceRole.slice(6)):null;
    $('position-fields').hidden=!node;
    if(node){$('position-mode').value=node.position_mode;$('position-value').value=node.position_mode==='ratio'?node.ratio*100:node.distance;positionLabel();}
    fillGlassEditor('piece',data,p?p.size[p.thickness_axis]:extra&&extra.size?extra.size[extra.thickness_axis]:data.thickness);
    refreshMaterialButtons();renderEdges();
    // Canonical form snapshot: compare only values that the user really changed.
    // Independently persisted edge clicks do not constitute an unsaved draft.
    pieceEditorBaseline=snapshotControls($('module-piece-editor'));
  }
  function mappedPieceEdge(edge){
    var p=selectedPiece()||selectedExtra();if(!p)return edge;
    var uv=[0,1,2].filter(function(i){return i!==p.thickness_axis;});
    return pieceEditorAxes[0]===uv[0]?edge:(edge[0]==='u'?'v':'u')+edge.slice(1);
  }
  function renderEdges(){
    try{
      if(glassEditors.piece){$('piece-cut-preview').textContent='';return;}
      var p=selectedPiece(),values={};
      ['u_min','u_max','v_min','v_max'].forEach(function(edge){values[edge]=pieceEdges.indexOf(mappedPieceEdge(edge))>=0;});
      var material=$('piece-material').value,entry=findCatalogMaterial(material);
      drawEdgePicker('piece',values,entry&&entry.color||null);
      $('piece-edge-summary').textContent=U.count(pieceEdges.length,'borda com fita','bordas com fita');
      if(!p){$('piece-cut-preview').textContent='';return;}
      var t=M.number($('piece-tape').value,'Espessura da fita',.1,5),uv=p.size.filter(function(v,i){return i!==p.thickness_axis;});
      var cut=uv.map(function(v,i){return v-($('piece-decrement').checked?pieceEdges.filter(function(e){return e[0]===(i===0?'u':'v');}).length*t:0);});
      $('piece-cut-preview').textContent='Corte da face: '+format(cut[0])+' × '+format(cut[1])+' mm';
    }catch(e){$('piece-cut-preview').textContent=e.message;}
  }
  function positionLabel(){$('position-unit').textContent=$('position-mode').value==='ratio'?'Proporção (%)':'Medida livre do vão (mm)';}
  function startPreviewDrag(event,piece,scale,ox,oy){
    if(state.busy||event.button!==0)return;event.preventDefault();
    var rect=$('preview').getBoundingClientRect(),id=piece.role.slice(6),node=M.find(state.params,id),region=M.layout(state.params).nodes[id];
    var svgX=(event.clientX-rect.left)*400/rect.width,svgY=(event.clientY-rect.top)*260/rect.height;
    var current=node.split==='horizontal'?state.params.height-(svgY-oy)/scale:(svgX-ox)/scale;
    previewDrag={original:M.clone(state.params),id:id,horizontal:node.split==='horizontal',scale:scale,ox:ox,oy:oy,region:region,grab:current-(node.split==='horizontal'?piece.z:piece.x),moved:false};
    state.pieceRole=piece.role;$('preview').setPointerCapture(event.pointerId);
  }
  $('preview').addEventListener('pointermove',function(event){
    if(!previewDrag)return;var drag=previewDrag,rect=this.getBoundingClientRect();
    var svgX=(event.clientX-rect.left)*400/rect.width,svgY=(event.clientY-rect.top)*260/rect.height;
    var current=drag.horizontal?drag.original.height-(svgY-drag.oy)/drag.scale:(svgX-drag.ox)/drag.scale;
    var free=drag.region[drag.horizontal?'height':'width']-M.thickness(drag.original,'split:'+drag.id);
    var value=Math.max(0,Math.min(free,current-drag.region[drag.horizontal?'z':'x']-drag.grab));
    var center=Math.abs(value-free/2)<10/drag.scale,p=M.clone(drag.original),node=M.find(p,drag.id);
    node.position_mode=center?'ratio':'start';if(center)node.ratio=.5;else node.distance=Math.round(value*10)/10;
    try{state.params=M.normalize(p);drag.moved=true;renderPreview();message(center?'Ímã: centro. Os vãos continuam iguais ao redimensionar.':'Distância da base / esquerda: '+format(value)+' mm.');}catch(e){message(e.message,'error');}
  });
  $('preview').addEventListener('pointerup',function(){if(previewDrag){var moved=previewDrag.moved,p=state.params;state.params=previewDrag.original;previewDrag=null;if(moved){try{commitInternal(p);}catch(e){message(e.message,'error');}}renderPreview();updateChrome();}});
  $('preview').addEventListener('pointercancel',function(){if(previewDrag){state.params=previewDrag.original;previewDrag=null;renderPreview();}});
  $('position-mode').addEventListener('change',function(){
    if(state.pieceRole.indexOf('split:')!==0)return;
    positionLabel();var node=M.find(state.params,state.pieceRole.slice(6)),r=M.layout(state.params).nodes[node.id],free=r[node.split==='horizontal'?'height':'width']-M.thickness(state.params,state.pieceRole),distance=M.splitDistance(node,free);
    $('position-value').value=this.value==='ratio'?Math.round(distance/free*10000)/100:Math.round((this.value==='end'?free-distance:distance)*10)/10;
  });
  ['piece-tape','piece-decrement'].forEach(function(id){$(id).addEventListener('input',renderEdges);});
  $('piece-material').addEventListener('input',function(){$('piece-grain').value=materialGrain(this.value,$('piece-grain').value);renderEdges();});
  $('back-to-pieces').addEventListener('click',closeModulePieceEditor);
  function pieceEditorTarget(){
    if(selectionKind==='piece')return [selectionPayload.pieces[0].path,''];
    return [state.target,state.pieceRole];
  }
  ['delete-piece','solo-delete-piece'].forEach(function(id){$(id).addEventListener('click',function(){clearEdgeHover();request('delete_piece',pieceEditorTarget());});});
  ['detach-piece','solo-detach-piece'].forEach(function(id){$(id).addEventListener('click',function(){clearEdgeHover();request('detach_piece',pieceEditorTarget());});});
  $('detach-panel-units').addEventListener('click',function(){request('detach_panel_units',[state.target]);});
  $('solo-back-to-pieces').addEventListener('click',function(){selectionPayload.selection_return?request('back_to_selection',[]):request('back_to_pieces',pieceEditorTarget());});

  var pieceApplyPending=null,edgePending=null;
  function fillPieceElevation(prefix,value){
    var input=$(prefix+'-elevation'),known=typeof value==='number'&&isFinite(value);
    input.disabled=!known;input.value=known?measureText(value):'';
    // A module-owned piece does not offer an independent elevation.
    var row=input.closest('label');if(row)row.hidden=!known;
    input.dataset.originalElevation=input.value;
  }
  function changedPieceElevation(prefix){
    var input=$(prefix+'-elevation');
    return input.disabled||input.value===input.dataset.originalElevation?null:M.number(input.value,'Elevação',-100000,100000);
  }
  function pieceEditorData(previous){
    var material=$('piece-material').value;
    var saved=M.clone(previous&&previous.settings||{});delete saved.adjustment;
    if(glassEditors.piece)Object.assign(saved,readGlassEditor('piece'));
    return M.normalizePiece(Object.assign(saved,{
      cut_orientation:previous&&previous.settings&&previous.settings.cut_orientation,
      name:$('piece-name').value,
      edge_materials:previous&&previous.settings&&previous.settings.edge_materials,
      thickness:$('piece-thickness').value,
      material:material,
      grain:materialGrain(material,previous&&previous.settings&&previous.settings.grain),
      edges:pieceEdges,
      edge_override:!!saved.edge_override||JSON.stringify(pieceEdges.slice().sort())!==JSON.stringify((saved.edges||[]).slice().sort()),
      tape_thickness:$('piece-tape').value,
      edge_decrement:$('piece-decrement').checked
    }));
  }
  function applyModulePiece(){
    if(state.dirty){message('Conclua ou cancele a edição do módulo antes de alterar esta peça.','error');return;}
    try{
      var previous=selectedPiece(),extra=selectedExtra(),data=pieceEditorData(previous||extra),pieceElevation=changedPieceElevation('piece');
      if(extra){
        if(state.dirty)throw new Error('Conclua ou cancele as alterações do módulo antes de editar a peça avulsa.');
        data.size=extra.size.slice();data.size[pieceEditorAxes[0]]=M.number($('piece-u').value,'Comprimento da peça',3,10000);data.size[pieceEditorAxes[1]]=M.number($('piece-v').value,'Largura da peça',3,10000);data.size[extra.thickness_axis]=data.thickness;
        request('set_extra_data',[state.target,state.pieceRole.slice(6),data,pieceElevation]);
        return;
      }
      if(!previous)throw new Error('A peça não está mais disponível.');
      var p=readForm();
      if(state.pieceRole.indexOf('split:')===0){
        var node=M.find(p,state.pieceRole.slice(6)),mode=$('position-mode').value,value=M.number($('position-value').value,mode==='ratio'?'Proporção (%)':'Posição',0,4000);
        node.position_mode=mode;if(mode==='ratio')node.ratio=value/100;else node.distance=value;
      }
      p.piece_settings[state.pieceRole]=data;


      // Calculate length/width as a delta from the structurally generated piece.
      var base=M.normalize(p),basePiece=M.layout(base).panels.filter(function(item){return item.role===state.pieceRole;})[0];
      if(!basePiece)throw new Error('A peça não pôde ser recalculada.');
      var desired=basePiece.size.slice();
      desired[pieceEditorAxes[0]]=M.number($('piece-u').value,'Comprimento da peça',1,10000);
      desired[pieceEditorAxes[1]]=M.number($('piece-v').value,'Largura da peça',1,10000);
      var offset=previous.settings.adjustment&&previous.settings.adjustment.offset?previous.settings.adjustment.offset.slice():[0,0,0];
      var delta=desired.map(function(value,index){return index===basePiece.thickness_axis?0:value-basePiece.size[index];});
      if(delta.some(function(value){return Math.abs(value)>1e-7;})||offset.some(function(value){return Math.abs(value)>1e-7;}))data.adjustment={size:delta,offset:offset};
      p.piece_settings[state.pieceRole]=data;
      p=M.normalize(p);
      var elevation=M.number($('elevation').value,'Elevação',-100000,100000);
      message('Aplicando alteração à peça…');
      pieceApplyPending='module';
      request('update_module',[p,state.target,elevation,false,pieceElevation===null?null:{role:state.pieceRole,elevation:pieceElevation}]);
    }catch(e){message(e.message,'error');}
  }
  $('edit-in-model').addEventListener('click',function(){request('edit_divisions',[state.target]);});
  $('save-production').addEventListener('click',function(){request('save_production',[productionOverrides()]);});
  $('improve-cut').addEventListener('click',function(){request('improve_cut');});
  $('cancel-cut').addEventListener('click',function(){if(nativeMode)request('cancel_cut',[],true);});
  function renderOffcuts(){
    $('offcut-list').textContent='';cutOffcuts.forEach(function(r,i){var row=document.createElement('p');row.textContent=r.quantity+' × '+r.length+' × '+r.width+' mm · '+r.material+' '+r.thickness+' mm ';var remove=document.createElement('button');remove.textContent='Remover';remove.className='text-button danger';remove.addEventListener('click',function(){if(state.searching)return;cutOffcuts.splice(i,1);renderOffcuts();invalidatePlan();});row.appendChild(remove);$('offcut-list').appendChild(row);});
  }
  $('add-offcut').addEventListener('click',function(){try{var r={material:$('offcut-material').value.trim()};if(!r.material)throw new Error('Informe o material do retalho.');['length','width','thickness','quantity'].forEach(function(k){r[k]=M.number($('offcut-'+k).value,'Retalho',k==='quantity'||k==='thickness'?1:50,k==='quantity'||k==='thickness'?100:10000);});if(r.quantity!==Math.floor(r.quantity))throw new Error('Quantidade deve ser inteira.');cutOffcuts.push(r);renderOffcuts();invalidatePlan();}catch(e){message(e.message,'error');}});
  function invalidatePlan() {
    state.cutPlan=null;$('cut-sheets').textContent='';$('cut-result-metrics').hidden=true;$('cut-summary').textContent='Configurações alteradas. Gere o plano novamente.';if(cutStep===3)setCutStep(2);updateChrome();
  }
  function setCutStep(step){
    cutStep=step;
    [1,2,3].forEach(function(n){$('cut-step-'+n).hidden=n!==step;});
    document.querySelectorAll('.cut-steps button').forEach(function(b){var active=Number(b.dataset.cutStep)===step;b.classList.toggle('active',active);b.setAttribute('aria-current',active?'step':'false');});
    if(step===2)renderStocks();
  }
  document.querySelectorAll('[data-cut-step]').forEach(function(button){button.addEventListener('click',function(){setCutStep(Number(this.dataset.cutStep));});});
  $('cut-next').addEventListener('click',function(){setCutStep(2);});
  function materialGroups(){
    var groups={};if(!state.production)return [];
    state.production.rows.forEach(function(row){var material=$('cut-material-'+row.id).value.trim(),key=JSON.stringify([material,row.thickness]);if(!groups[key])groups[key]={key:key,material:material,thickness:row.thickness,count:0};groups[key].count++;});
    return Object.keys(groups).map(function(key){return groups[key];});
  }
  function renderStocks(){
    var list=$('cut-stock-groups');list.textContent='';
    materialGroups().forEach(function(group){
      var values=stockSizes[group.key]||(stockSizes[group.key]={length:$('sheet-length').value,width:$('sheet-width').value});
      var card=document.createElement('section'),title=document.createElement('h3'),count=document.createElement('p'),row=document.createElement('div');card.className='stock-card';title.textContent=(group.material||'Material sem nome')+' · '+format(group.thickness)+' mm';count.textContent=countText(group.count,'peça deste material e espessura','peças deste material e espessura');row.className='construction-row';card.appendChild(title);card.appendChild(count);
      ['length','width'].forEach(function(k){var label=document.createElement('label'),input=document.createElement('input');label.className='field';label.textContent=k==='length'?'Comprimento da chapa (mm)':'Largura da chapa (mm)';input.value=values[k];input.inputMode='decimal';input.setAttribute('aria-label',label.textContent+' — '+title.textContent);input.addEventListener('input',function(){values[k]=this.value;invalidatePlan();});label.appendChild(input);row.appendChild(label);});card.appendChild(row);list.appendChild(card);
    });
  }
  function productionOverrides() {
    var result={};
    if(state.production)state.production.rows.forEach(function(r){
      result[r.id]={material:$('cut-material-'+r.id).value};
    });
    return result;
  }
  function productionPartialNotice(){
    var area=$('production-partial-notice');if(!area){area=document.createElement('p');area.id='production-partial-notice';area.className='plany-operation-feedback error';$('tab-production').insertBefore(area,$('tab-production').firstChild);}
    area.hidden=!state.partialApproval&&!state.productionStale;
    area.textContent=state.productionStale?'Esta coleta mudou. Atualize a coleta antes de preparar ou exportar um plano.':state.partialApproval?'PLANO PARCIAL — PEÇAS PENDENTES. '+U.count(state.partialApproval.included_piece_count,'peça incluída','peças incluídas')+'; '+U.count(state.partialApproval.excluded_count,'pendência fora do corte.','pendências fora do corte.'):'';
  }
  function renderProductionIssues(){
    var box=$('production-issues'),data=state.production;box.textContent='';productionPartialNotice();if(!data||!data.issues.length)return;
    var details=data.issue_details||data.issues.map(function(message,i){return {code:'D'+(i+1),name:'Peça a conferir',module:'Coleta anterior',reason:'Não passou na verificação para corte.',detail:message};});
    var intro=document.createElement('p');intro.textContent='A coleta terminou: '+U.count(details.length,'pendência precisa','pendências precisam')+' de conferência para corte. As peças válidas continuam disponíveis. Nenhuma peça foi excluída do modelo.';box.appendChild(intro);
    details.forEach(function(item,index){
      var row=document.createElement('article'),title=document.createElement('h4'),reason=document.createElement('p'),extra=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('p');
      row.className='plany-production-issue';title.textContent=(item.code||'D'+(index+1))+' · '+item.module+' · '+item.name;reason.textContent=item.reason;
      summary.textContent='Ver detalhes';text.textContent=U.diagnostic((item.hierarchy||[]).join(' → ')+' · Ocorrência: '+(item.occurrence_id||'Atualize a coleta')+' · '+item.detail+' Confira grupos internos, faces/arestas, forma e solidez; depois atualize a coleta.');extra.appendChild(summary);extra.appendChild(text);row.appendChild(title);row.appendChild(reason);row.appendChild(extra);
      if(item.occurrence_id&&state.productionContext){var locate=document.createElement('button');locate.type='button';locate.className='small-button';locate.textContent='Localizar / Corrigir no SketchUp';locate.disabled=!!state.productionStale;locate.onclick=function(){request('locate_production_issue',[state.productionContext.token,item.occurrence_id]);};row.appendChild(locate);}box.appendChild(row);
    });
    var refresh=document.createElement('button');refresh.type='button';refresh.className='small-button';refresh.textContent='Atualizar coleta';refresh.onclick=function(){$('read-production').click();};box.appendChild(refresh);
    var proceed=document.createElement('button');proceed.id='continue-valid-production';proceed.type='button';proceed.className='primary';proceed.textContent=state.partialApproval?'Revisar pendências':'Continuar com peças válidas';proceed.disabled=!!state.productionStale||!state.productionContext||!data.rows.length||details.some(function(item){return !item.occurrence_id||item.kind!=='part';});box.appendChild(proceed);
    var confirmation=document.createElement('section');confirmation.hidden=true;var notice=document.createElement('p');notice.textContent='Plano parcial: '+U.count(data.rows.length,'peça incluída','peças incluídas')+'; '+U.count(details.length,'pendência fora do corte','pendências fora do corte')+'. Excluir somente deste plano: '+details.map(function(item){return item.code+' · '+item.module+' · '+item.name;}).join('; ')+'. A geometria e o diagnóstico serão preservados.';confirmation.appendChild(notice);
    var cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancelar';cancel.onclick=function(){confirmation.hidden=true;};var accept=document.createElement('button');accept.id='confirm-partial-production';accept.type='button';accept.className='primary';accept.textContent='Confirmar plano parcial';accept.onclick=function(){accept.disabled=cancel.disabled=true;request('accept_partial_production',[state.productionContext.token]);};confirmation.appendChild(cancel);confirmation.appendChild(accept);box.appendChild(confirmation);
    proceed.onclick=function(){if(state.partialApproval){request('revoke_partial_production',[state.productionContext.token]);return;}confirmation.hidden=false;confirmation.scrollIntoView({block:'nearest'});accept.focus();};
    if(details.some(function(item){return item.kind==='module';})){var structural=document.createElement('p');structural.textContent='A configuração de um módulo precisa ser revista antes de preparar um corte parcial seguro. O resumo continua disponível.';box.appendChild(structural);}
    if(!state.productionContext){var old=document.createElement('p');old.textContent='Atualize a coleta para identificar cada ocorrência antes de preparar um plano parcial.';box.appendChild(old);}
  }
  function invalidateProduction(){if(!state.production)return;state.productionStale=true;state.partialApproval=null;state.cutPlan=null;$('cut-sheets').textContent='';$('cut-summary').textContent='';setCutStep(1);renderProductionIssues();}
  function renderProduction(data) {
    state.production=data;state.cutPlan=null;$('cut-result-metrics').hidden=true;setCutStep(1);
    $('piece-rows').textContent='';$('cut-sheets').textContent='';$('cut-summary').textContent='';
    var glassCount=((data.materials||{}).other_parts||[]).filter(function(item){return item.kind==='glass';}).reduce(function(total,item){return total+item.quantity;},0);
    var summary=$('production-summary');summary.textContent='';
    if(data.rows.length||glassCount||data.materials){
      var counts=document.createElement('ul');counts.className='production-counts';
      var retalho=data.rows.filter(function(row){return ['Retalho','SOBRA','builtin:surplus'].indexOf(row.material)>=0;}),mdfs=data.rows.filter(function(row){return retalho.indexOf(row)<0;});
      var names=mdfs.map(function(row){return row.material;}).filter(function(value,i,list){return list.indexOf(value)===i;});
      var thicknesses=data.rows.map(function(row){return Number(row.thickness);}).filter(function(value,i,list){return list.indexOf(value)===i;}).sort(function(a,b){return a-b;});
      var items=['Peças para corte: '+data.rows.length,'Módulos: '+data.modules,'Peças avulsas: '+(data.loose_parts||0)];
      if(names.length)items.push('MDFs: '+names.length);
      if(thicknesses.length)items.push('Espessuras: '+thicknesses.map(format).join(' / ')+' mm');
      if(retalho.length)items.push('Peças em Retalho: '+retalho.length);
      if(glassCount)items.push('Vidros: '+glassCount);
      var pendingCount=(data.issue_details||[]).length||data.issues.length;if(pendingCount)items.push('Pendências: '+pendingCount);
      items.forEach(function(text){var item=document.createElement('li');item.textContent=text;counts.appendChild(item);});summary.appendChild(counts);
    }else summary.textContent='Nenhuma peça encontrada. Selecione os móveis ou escolha Todo o projeto.';
    renderProductionIssues();
    data.rows.forEach(function(r){
      var tr=document.createElement('tr');
      var name=document.createElement('td');name.textContent=r.id+' · '+r.name;var small=document.createElement('small');small.textContent=r.module;name.appendChild(small);tr.appendChild(name);
      var dims=document.createElement('td');dims.textContent=format(r.length)+' × '+format(r.width)+' × '+format(r.thickness);
      if(r.edge_decrement){var finished=document.createElement('small');finished.textContent='Acabado: '+format(r.finished_length)+' × '+format(r.finished_width);dims.appendChild(finished);}tr.appendChild(dims);
      var material=document.createElement('td'),input=document.createElement('input');input.id='cut-material-'+r.id;input.value=r.material;input.maxLength=M.MATERIAL_NAME_LIMIT;input.setAttribute('aria-label','Material de '+r.id);input.addEventListener('input',invalidatePlan);material.appendChild(input);
      if(!r.construction_type||r.construction_type==='mdf'){input.type='hidden';material.appendChild(createMaterialChoice(input,{label:'Material de '+r.id}));}
      tr.appendChild(material);
      $('piece-rows').appendChild(tr);
    });
    renderMaterialList(data.materials);
    updateChrome();
  }
  function materialLine(label,quantity,detail){
    var item=document.createElement('li'),title=document.createElement('strong'),amount=document.createElement('span');
    title.textContent=label;amount.textContent=quantity;item.appendChild(title);item.appendChild(amount);
    if(detail){var small=document.createElement('small');small.textContent=detail;item.appendChild(small);}
    return item;
  }
  function renderMaterialList(materials){
    var content=$('material-list-content');content.textContent='';
    $('material-list-scope').textContent=productionScope()==='all'?'Todo o projeto':'Somente a seleção';
    if(!materials){content.textContent='Carregue peças e materiais para consultar a lista.';return;}
    var sections=[
      ['Corrediças',materials.slides||[],function(item){
        var runner={telescopic:'Telescópica',concealed:'Oculta',custom:'Personalizada'}[item.runner]||item.runner;
        return [runner+(item.length?' · '+format(item.length)+' mm':''),item.quantity+' '+(item.quantity===1?'par':'pares'),
          'Profundidade da caixa: '+format(item.box_depth)+' mm'+(item.length?' · comprimento nominal da corrediça':' · comprimento da ferragem não definido')];
      }],
      ['Dobradiças',materials.hinges||[],function(item){return ['Dobradiça '+item.kind+' · '+item.angle+'°',item.quantity+' un.','Tipo conforme a posição da porta'];}],
      ['Fitas de borda',materials.edge_banding||[],function(item){return ['Fita '+format(item.width)+' mm · '+item.material,format(item.length_m)+' m lineares',countText(item.quantity,'borda','bordas')];}],
      ['Vidros',(materials.other_parts||[]).filter(function(item){return item.kind==='glass';}),function(item){return [item.name+' · '+item.material,item.quantity+' un.',format(item.length)+' × '+format(item.width)+' × '+format(item.thickness)+' mm por unidade · '+PlanyGlass.detail(item)];}],
      ['Outras peças',(materials.other_parts||[]).filter(function(item){return item.kind!=='glass'&&item.kind!=='fixation';}),function(item){
        return [item.name,item.quantity+' un.',''];
      }],
      ['MDFs',materials.mdf||[],function(item){return [item.material+' · '+format(item.thickness)+' mm',countText(item.quantity,'peça','peças'),format(item.area_m2)+' m² de área das peças'];}]
    ];
    if(materials.metals&&materials.metals.length)sections.push(['Metais',materials.metals,function(item){return [item.name+' · '+item.material,countText(item.quantity,'peça','peças'),format(item.length)+' × '+format(item.width)+' × '+format(item.thickness)+' mm'];}]);
    sections.filter(function(section){return section[1].length;}).forEach(function(section){
      var box=document.createElement('section'),heading=document.createElement('h3'),list=document.createElement('ul');
      box.className='material-group';heading.textContent=section[0];list.className='material-group-items';box.appendChild(heading);
      if(!section[1].length){var empty=document.createElement('p');empty.className='hint';empty.textContent='Nenhum item nesta origem.';box.appendChild(empty);}
      else{section[1].forEach(function(item){var values=section[2](item);list.appendChild(materialLine(values[0],values[1],values[2]));});box.appendChild(list);}
      content.appendChild(box);
    });
    (materials.notes||[]).forEach(function(note){var warning=document.createElement('p');warning.className='material-list-note';warning.textContent=note;content.appendChild(warning);});
    var pending={};(materials.undetermined||[]).forEach(function(item){var text=item.name+' — NÃO DETERMINADO: '+item.reason;if(pending[text])return;pending[text]=true;var warning=document.createElement('p');warning.className='material-list-note';warning.textContent=text;content.appendChild(warning);});
  }
  function renderCut(plan) {
    state.cutPlan=plan;$('cut-sheets').textContent='';setCutStep(3);
    var sheets=[],used=0,area=0;plan.groups.forEach(function(g){sheets=sheets.concat(g.sheets);});sheets.forEach(function(s){area+=s.length*s.width;used+=s.used_area===undefined?s.placements.reduce(function(sum,p){return sum+p.w*p.h;},0):s.used_area;});
    var metrics=$('cut-result-metrics');metrics.textContent='';metrics.hidden=false;
    [[plan.full_sheet_count===undefined?plan.sheet_count:plan.full_sheet_count,'chapas inteiras'],[area?format(100*used/area)+'%':'—','aproveitamento total']].forEach(function(pair){var card=document.createElement('div'),number=document.createElement('strong'),label=document.createElement('span');number.textContent=pair[0];label.textContent=pair[1];card.appendChild(number);card.appendChild(label);metrics.appendChild(card);});
    ['length','width','kerf','margin'].forEach(function(k){$('sheet-'+k).value=String(plan.settings[k]).replace('.',',');});
    $('cut-summary').textContent=countText((plan.full_sheet_count===undefined?plan.sheet_count:plan.full_sheet_count),'chapa inteira','chapas inteiras')+' · '+countText(plan.offcut_count||0,'retalho físico','retalhos físicos')+' · '+countText(plan.piece_count,'peça distribuída','peças distribuídas')+' · '+(plan.virtual_piece_count||0)+' em Retalhos · '+(plan.attempts_per_group||4)+' tentativas por material'+
      (plan.unplaced.length?' · NÃO COUBERAM: '+plan.unplaced.map(function(r){return r.id+' ('+r.length+' × '+r.width+')';}).join(', '):'');
    $('cut-summary').className=plan.unplaced.length?'cut-error':'cut-total';
    plan.groups.concat(plan.virtual_groups||[]).forEach(function(g){
      g.sheets.forEach(function(sheet,index){
        var card=document.createElement('section');card.className='cut-sheet';
        var title=document.createElement('h2');title.textContent=g.material+' · '+format(g.thickness)+' mm · '+(sheet.virtual?'Chapa virtual':(sheet.offcut?'Retalho físico '+sheet.stock_id:'Chapa')+' '+(index+1));card.appendChild(title);
        var sub=document.createElement('p');sub.textContent=(sheet.virtual?'Chapa virtual':'Aproveitamento '+format(sheet.utilization)+'%')+' · '+countText(sheet.placements.length,'peça','peças');card.appendChild(sub);
        var sl=sheet.virtual?sheet.canvas.width:sheet.length||plan.settings.length,sw=sheet.virtual?sheet.canvas.height:sheet.width||plan.settings.width;
        var svg=el('svg',{viewBox:'0 0 '+sl+' '+sw,role:'img','aria-label':title.textContent});
        svg.appendChild(el('rect',{x:0,y:0,width:sl,height:sw,fill:'#efe6d7'}));
        (sheet.free||[]).forEach(function(r){var rect=el('rect',{x:r.x,y:r.y,width:r.w,height:r.h,fill:'#fff9de',stroke:'#c1a35a','stroke-width':1});rect.appendChild(el('title',{},'Sobra prevista: '+format(r.w)+' × '+format(r.h)+' mm'));svg.appendChild(rect);});
        sheet.placements.forEach(function(p){
          var rect=el('rect',{x:p.x,y:p.y,width:p.w,height:p.h,fill:'#d5e4d3',stroke:'#61806a','stroke-width':2});
          rect.appendChild(el('title',{},p.id+' · '+p.name+' · '+format(p.w)+' × '+format(p.h)+' mm'+(p.rotated?' · girada':'')));svg.appendChild(rect);
          if(p.w>100&&p.h>45)svg.appendChild(el('text',{x:p.x+p.w/2,y:p.y+p.h/2+8,'text-anchor':'middle','font-size':Math.min(34,p.h*.45),fill:'#284d35'},p.id));
        });
        card.appendChild(svg);
        if(sheet.virtual){$('cut-sheets').appendChild(card);return;}
        var leftovers=document.createElement('p');leftovers.className='cut-leftovers';
        var sorted=(sheet.free||[]).slice().sort(function(a,b){return b.w*b.h-a.w*a.h;});leftovers.textContent=sl+' × '+sw+' mm · Maiores sobras: '+sorted.slice(0,3).map(function(r){return format(r.w)+' × '+format(r.h)+' mm';}).join(' / ');card.appendChild(leftovers);
        var cuts=document.createElement('details');cuts.className='cut-sequence';var summary=document.createElement('summary');summary.textContent='Sequência de '+sheet.cuts.length+' cortes';cuts.appendChild(summary);
        var hint=document.createElement('p');hint.textContent='Após o refilo. Coordenadas a partir do canto superior esquerdo do desenho; serra avança à direita/abaixo da borda indicada.';cuts.appendChild(hint);
        var list=document.createElement('ol');sheet.cuts.forEach(function(c){var li=document.createElement('li');li.textContent=(c.axis==='x'?'Vertical · X':'Horizontal · Y')+' = '+format(c.at)+' mm, de '+format(c.from)+' até '+format(c.to)+' mm';list.appendChild(li);});cuts.appendChild(list);card.appendChild(cuts);$('cut-sheets').appendChild(card);
      });
    });
    updateChrome();
  }
  function clearProduction() {
    state.production=null;state.cutPlan=null;state.productionContext=null;state.partialApproval=null;state.productionStale=false;productionPartialNotice();
    $('cut-result-metrics').hidden=true;$('production-issues').textContent='';$('piece-rows').textContent='';$('cut-sheets').textContent='';$('cut-summary').textContent='';
    $('material-list-content').textContent='';$('material-list-view').hidden=true;document.querySelector('#tab-production .central-launch').hidden=false;
    $('production-summary').textContent='Clique em Carregar peças e materiais para ler esta origem.';setCutStep(1);updateChrome();
  }
  function renderCentralSetup(setup){
    centralSetupStep=setup&&setup.step||'';
    var box=$('central-setup'),title=$('central-setup-title'),info=$('central-setup-text'),action=$('central-setup-action'),check=$('central-setup-check');
    box.hidden=!centralSetupStep||centralSetupStep==='linked';
    if(box.hidden)return;
    if(centralSetupStep==='runtime'){
      title.textContent='Preparação da Central Plany';
      info.textContent='A Central precisa baixar os arquivos necessários ao primeiro uso. Seus projetos serão preservados.';
      action.textContent='Preparar Central';action.dataset.action='runtime';action.disabled=false;action.hidden=false;check.hidden=true;
    }else if(centralSetupStep==='preparing'){
      title.textContent='Preparando a Central Plany';
      info.textContent='Baixando e conferindo os arquivos necessários. A Central abrirá quando estiver pronta.';
      action.hidden=true;check.hidden=true;
    }else if(centralSetupStep==='app'){
      title.textContent='Instalar a Central como app';
      info.textContent='No Edge, abra a Central e clique no ícone Instalar aplicativo na barra de endereços. Depois verifique o vínculo aqui.';
      action.textContent='Abrir no Edge para instalar';action.dataset.action='browser';action.disabled=false;action.hidden=false;check.hidden=false;
    }
  }
  function productionScope() { return document.querySelector('input[name="production-scope"]:checked').value; }
  $('read-production').addEventListener('click',function(){clearProduction();request('read_production',[productionScope()]);});
  $('open-central').addEventListener('click',function(){request('open_central',[productionScope()]);});
  $('open-material-list').addEventListener('click',function(){if(!state.production)return;renderMaterialList(state.production.materials);document.querySelector('#tab-production .central-launch').hidden=true;$('material-list-view').hidden=false;document.querySelector('main').scrollTop=0;});
  $('back-production').addEventListener('click',function(){$('material-list-view').hidden=true;document.querySelector('#tab-production .central-launch').hidden=false;document.querySelector('main').scrollTop=0;});
  $('open-central-saved').addEventListener('click',function(){request('open_central',['saved']);});
  $('central-setup-action').addEventListener('click',function(){request('central_setup',[this.dataset.action]);});
  $('central-setup-check').addEventListener('click',function(){request('central_setup',['verify']);});
  $('production-scope').addEventListener('change',clearProduction);
  $('optimize-cut').addEventListener('click',function(){
    var settings={};['length','width','kerf','margin'].forEach(function(k){settings[k]=$('sheet-'+k).value;});
    settings.sheet_sizes=materialGroups().map(function(g){return {material:g.material,thickness:g.thickness,length:stockSizes[g.key].length,width:stockSizes[g.key].width};});
    settings.attempts=$('cut-effort').value;settings.offcuts=M.clone(cutOffcuts);request('optimize_cut',[settings,productionOverrides()]);
  });
  $('export-cut').addEventListener('click',function(){request('export_cut');});
  ['length','width','kerf','margin'].forEach(function(k){$('sheet-'+k).addEventListener('input',invalidatePlan);});
  $('cut-effort').addEventListener('change',invalidatePlan);

  function rememberDraft(){
    var draft=captureSelectionDraft();if(draft)drafts[selectionKey]=draft;
  }
  function formValuesChanged(original,current){
    if(!original)return true; // Never silently discard fields without a baseline.
    return Object.keys(current||{}).some(function(id){
      return !original[id]||String(original[id].value)!==String(current[id].value);
    });
  }
  function draftHasUncommittedChanges(draft){
    if(!draft)return false;
    if(typeof draft.pendingChanges==='boolean')return draft.pendingChanges;
    // Older reload snapshots did not mark piece drafts. Treat uncertain
    // legacy content conservatively rather than risk losing typed work.
    return !!draft.dirty||Object.keys(draft.pieceDrafts||{}).some(function(id){
      return draft.pieceDrafts[id].edited!==false;
    })||!!(draft.ui&&draft.ui.editor)||Object.keys(draft.ui&&draft.ui.bulkChanges||{}).length>0;
  }
  function returnContextValid(context){
    return context&&context.revision===operations.revision&&context.generation===operations.generation&&
      context.model===operations.model&&context.modelGeneration===operations.modelGeneration;
  }
  function returnStamp(){return {revision:operations.revision,generation:operations.generation,model:operations.model,modelGeneration:operations.modelGeneration};}
  function restoreNavigationScroll(value){
    var key=selectionKey,stamp=returnStamp();
    window.setTimeout(function(){if(key===selectionKey&&returnContextValid(stamp))document.querySelector('main').scrollTop=value||0;},0);
  }
  function snapshotControls(root){
    var values={};if(!root)return values;
    root.querySelectorAll('input[id],select[id],textarea[id]').forEach(function(control){
      var numeric=numericDrafts.get(control);
      values[control.id]={value:control.type==='checkbox'?control.checked:control.value,numeric:numeric&&M.clone(numeric)};
    });return values;
  }
  function restoreControls(values){
    Object.keys(values||{}).forEach(function(id){var control=$(id),saved=values[id];if(!control)return;
      if(control.type==='checkbox')control.checked=saved.value;else control.value=saved.value;
      if(saved.numeric)numericDrafts.set(control,saved.numeric);
    });
  }
  function snapshotBatch(){
    if(!divisionBatch)return null;
    var saved=Object.assign({key:selectionKey,roles:divisionBatch.roles.slice(),fields:{},keep:divisionBatch.keep.checked,
      keepChanged:String(divisionBatch.keep.checked)!==divisionBatch.keep.dataset.initial,scroll:document.querySelector('main').scrollTop,originScroll:divisionBatch.originScroll},returnStamp());
    Object.keys(divisionBatch.fields).forEach(function(key){var control=divisionBatch.fields[key],numeric=numericDrafts.get(control);saved.fields[key]={value:control.value,changed:control.value!==control.dataset.initial,numeric:numeric&&M.clone(numeric)};});return saved;
  }
  function restoreBatchFields(saved){
    Object.keys(saved.fields).forEach(function(key){if(divisionBatch.fields[key]&&saved.fields[key].changed!==false){var field=divisionBatch.fields[key];field.value=saved.fields[key].value;if(saved.fields[key].numeric)numericDrafts.set(field,saved.fields[key].numeric);}});
    if(saved.keepChanged!==false)divisionBatch.keep.checked=saved.keep;divisionBatch.originScroll=saved.originScroll;
    if($('plany-batch-editor').onchange)$('plany-batch-editor').onchange();
  }
  function captureSelectionDraft(){
    if(!selectionKey||!['module','bulk','mixed','pieces','volume'].includes(selectionKind))return null;
    var inputs={};dimensionKeys.concat(constructionKeys,['name','elevation']).forEach(function(k){inputs[k]=$(k).value;});inputs.back=$('back').checked;
    var editor=divisionBatch?{kind:'batch',batch:snapshotBatch()}:
      divisionEdit&&!divisionEdit.isNew?{kind:'division',id:divisionEdit.id,fields:snapshotControls($('division-editor'))}:
      state.editingFront?{kind:'front',id:state.editingFront,fields:snapshotControls($('front-editor'))}:
      editingCladding?{kind:'cladding',id:editingCladding,fields:snapshotControls($('cladding-editor'))}:
      editingTrim?{kind:'trim',id:editingTrim,fields:snapshotControls($('trim-editor'))}:
      editingAccessory?{kind:'accessory',id:editingAccessory,fields:snapshotControls($('accessory-editor'))}:null;
    var previous=drafts[selectionKey],pieceDrafts=returnContextValid(previous)?M.clone(previous.pieceDrafts||{}):{};
    if(pieceEditorOpen){
      var pieceFields=snapshotControls($('module-piece-editor'));
      pieceDrafts[state.pieceRole]={fields:pieceFields,edges:pieceEdges.slice(),
        edited:formValuesChanged(pieceEditorBaseline,pieceFields)};
    }
    var batchChanged=editor&&editor.kind==='batch'&&(editor.batch.keepChanged||
      Object.keys(editor.batch.fields).some(function(id){return editor.batch.fields[id].changed;}));
    var pendingChanges=!!state.dirty||Object.keys(pieceDrafts).some(function(id){return pieceDrafts[id].edited!==false;})||
      !!batchChanged||!!(editor&&editor.kind!=='batch')||
      (['bulk','pieces','mixed'].indexOf(selectionKind)>=0&&Object.keys(bulkChanges).length>0);
    return Object.assign({params:M.clone(state.params),inputs:inputs,formControls:Object.assign(snapshotControls($('general-settings')),snapshotControls($('construction-settings'))),selected:state.selected,base:baseParams&&M.clone(baseParams),dirty:state.dirty,pieceDrafts:pieceDrafts,pendingChanges:pendingChanges,
      ui:{details:Array.prototype.map.call(document.querySelectorAll('main details[id]'),function(d){return [d.id,d.open];}),step:activeSelectionStep,pieces:piecesView,piece:pieceEditorOpen,role:state.pieceRole,editor:editor,
        pieceFields:pieceEditorOpen?snapshotControls($('module-piece-editor')):null,batchReturn:batchReturn&&M.clone(batchReturn),
        scroll:document.querySelector('main').scrollTop,piecesScroll:piecesScrollTop,history:$('insertions-history').open,
        volumeStep:volumeStep,bulkChanges:M.clone(bulkChanges)}},returnStamp());
  }
  function restoreSelectionDraft(draft){
    if(!returnContextValid(draft))return false;
    var ui=draft.ui;if(!ui)return false;(ui.details||[]).forEach(function(d){if($(d[0]))$(d[0]).open=d[1];});
    if(selectionKind!=='module'){
      volumeStep=selectionCapabilities()[ui.volumeStep]?ui.volumeStep:'general';bulkChanges=M.clone(ui.bulkChanges);
      Object.keys(bulkChanges).forEach(function(key){if($('bulk-'+key))$('bulk-'+key).value=bulkChanges[key];});updateBulk();updateChrome();restoreNavigationScroll(ui.scroll);return true;
    }
    activateSelectionStep(ui.step,false);$('insertions-history').open=ui.history;
    var editor=ui.editor;
    if(ui.pieces){setPiecesView(true);if(ui.piece){openModulePieceEditor(ui.role);restoreControls(ui.pieceFields);piecesScrollTop=ui.piecesScroll;batchReturn=ui.batchReturn;}}
    else if(editor){
      if(editor.kind==='batch'){var panels=M.layout(state.params).panels.filter(function(piece){return editor.batch.roles.includes(piece.role);});if(panels.length===editor.batch.roles.length){openDivisionBatch(panels);restoreBatchFields(editor.batch);}}
      else if(editor.kind==='division'){openDivision(editor.id,false);restoreControls(editor.fields);}
      else {focusPlanySelection({insertion:[editor.kind,editor.id]});restoreControls(editor.fields);}
    }
    updateChrome();restoreNavigationScroll(ui.scroll);return true;
  }
  function selectionIdentity(payload){
    var key=payload.selection_key||null;
    // The volume suffix describes the selection's envelope, not another cabinet.
    return key&&payload.selection_kind==='module'?String(key).split(':volume:')[0]:key;
  }
  function receiveSelection(payload){
    // Only a genuine lost edit deserves a persistent warning in the viewport.
    // Remove any previous conflict notice before processing the new selection.
    var previousNotice=$('plany-discarded-draft-warning');
    if(previousNotice)previousNotice.parentNode.removeChild(previousNotice);
    receiveModuleContext(payload,true);
    var incoming=selectionIdentity(payload),same=incoming===selectionKey;
    if(nativeEditError&&(nativeEditError.selection!==incoming||nativeEditError.model!==operations.model))nativeEditError=null;
    // The first bay click can change native selection/context while keeping
    // the same cabinet. Preserve its insertion editor across that handoff.
    if(insertSessionActive()&&payload.selection_kind==='module'&&state.target&&
      String(payload.target_id)===String(state.target))same=true;
    if(!same){
      // A change of selection cancels editors. Unconfirmed values must not
      // survive as saved drafts or reopen on returning to the old module.
      if(selectionKey)delete drafts[selectionKey];
      if(incoming)delete drafts[incoming];
      edgePending=null;
      clearEdgeHover();hideUndoToast();lastUndo=null;
      if($('insertions-history'))$('insertions-history').open=false;
      $('combine-warning').hidden=true;resetFrontEdit();materialDestination=null;materialGroup=null;pieceEditorOpen=false;
    }
    if(!same)finishVolumeSession();
    volumeContext=payload.volume||null;if(!same)volumeStep='general';
    selectionKey=incoming;selectionKind=payload.selection_kind||'empty';selectionPayload=payload;
    state.carcasses=payload.carcasses||[];state.compositeRoot=payload.composite_root_id||null;
    var containerChoices=$('container-carcasses');
    if(!containerChoices){containerChoices=document.createElement('div');containerChoices.id='container-carcasses';$('bulk-selection').appendChild(containerChoices);}
    containerChoices.textContent='';
    if(payload.container_target_id)(payload.module_children||payload.carcasses||[]).forEach(function(item,index){var row=document.createElement('div'),label=document.createElement('span'),button=document.createElement('button');row.className='internal-row';label.textContent=item.name||(item.family==='cabinet'?'Caixaria':item.family==='panel'?'Painel':'Módulo')+' '+(index+1);button.className='small-button';button.textContent=item.family==='cabinet'||item.family==='panel'?'Peças e materiais':'Materiais';button.addEventListener('click',function(){if(!state.busy)request('focus_carcass',[item.target_id,{insertion:['carcass']}]);});row.appendChild(label);row.appendChild(button);containerChoices.appendChild(row);});
    state.target=payload.target_id||null;state.extras=payload.extras||[];state.moduleMaterials=payload.module_materials||[];state.pieceElevations=payload.piece_elevations||{};baseElevation=payload.elevation===undefined?0:payload.elevation;
    if(same&&insertSessionActive()){
      state.conflict=false;return;
    }
    var draft=drafts[incoming],discarded=!!draft&&!returnContextValid(draft);
    var lostUserChanges=discarded&&draftHasUncommittedChanges(draft);
    if(discarded){delete drafts[incoming];draft=null;}
    if(selectionKind==='module'){
      if(same&&state.dirty){
        state.conflict=state.canonicalRevision!==operations.revision;
        if(state.conflict){delete drafts[incoming];state.dirty=false;state.conflict=false;fillForm(payload.params);baseParams=M.clone(payload.params);}
      }else{
        state.dirty=!!draft&&draft.dirty;state.conflict=false;
        fillForm(draft?draft.params:payload.params);state.selected=draft?draft.selected:'root';$('elevation').value=payload.elevation===undefined?'0':payload.elevation;
        if(draft){Object.keys(draft.inputs).forEach(function(k){if(k==='back')$(k).checked=draft.inputs[k];else $(k).value=draft.inputs[k];});restoreControls(draft.formControls);}
        baseParams=M.clone(draft?draft.base:payload.params);
      }
      message(state.dirty?'Alterações pendentes deste módulo foram preservadas.':'Seleção atualizada.');
    }else{
      state.dirty=false;state.conflict=false;
      if(['bulk','pieces','mixed','volume'].indexOf(selectionKind)>=0){
        bulkChanges={}; var count=(payload.targets||payload.pieces||[]).length; $('bulk-title').textContent=countText(count,selectionKind==='pieces'?'peça selecionada':selectionKind==='bulk'?'módulo selecionado':'item selecionado',selectionKind==='pieces'?'peças selecionadas':selectionKind==='bulk'?'módulos selecionados':'itens selecionados');
        $('bulk-front-fields').hidden=!payload.has_fronts; $('bulk-piece-thickness-field').hidden=selectionKind!=='pieces';
        ['material','front_material','front_thickness','thickness'].forEach(function(k){var v=(payload.common||{})[k],field=$('bulk-'+k),mixed=count>1&&v===null;field.dataset.mixed=String(mixed);field.placeholder=mixed?'Valores diferentes':'';if(field.tagName==='SELECT'){var empty=field.querySelector('option[value=""]');if(empty)empty.remove();if(v==null){empty=document.createElement('option');empty.value='';empty.textContent=mixed?'Valores diferentes':'Não informado';field.insertBefore(empty,field.firstChild);}}setValue('bulk-'+k,v);});updateBulk();
      }
      if(['bulk','pieces','mixed'].indexOf(selectionKind)>=0){$('bulk-grain').value=materialGrain(payload.common&&payload.common.material,payload.common&&payload.common.grain);refreshMaterialButtons();}
      if(selectionKind==='piece'){
        fillSolo(payload.pieces[0]);
        var navigation=payload.pieces[0].navigation||{};
        $('solo-back-to-pieces').textContent=payload.selection_return?'← Voltar à seleção':navigation.label||'Ver peças avulsas do projeto';
        $('solo-back-to-pieces').title=[navigation.title,navigation.scope_name].filter(Boolean).join(' · ');
      }
      if(selectionKind==='piece_group'){
        var list=$('group-piece-list');list.textContent='';
        var listContext=payload.piece_list_context||{title:'Peças avulsas do projeto'};
        appendPieceHeading(list,listContext.title,(payload.piece_list||[]).length);
        if(listContext.scope_name){var scope=document.createElement('p');scope.className='hint';scope.textContent=listContext.scope_name;list.appendChild(scope);}
        (payload.piece_list||[]).forEach(function(piece){var button=document.createElement('button');button.type='button';button.className='small-button';button.textContent=piece.name||'Peça';button.addEventListener('click',function(){request('open_piece',[piece.path]);});list.appendChild(button);});
      }
      message(payload.error|| (selectionKind==='empty'?'Selecione uma caixaria no projeto.':'Seleção atualizada.'),payload.error?'error':'');
    }
    if(volumeContext&&selectionKind!=='module'){fillForm(volumeContext.params);baseParams=M.clone(state.params);state.target=volumeContext.targets[0];$('elevation').value='0';baseElevation=0;}
    renderVolumeSelection();
    if(flow.componentEditing&&!componentEditorOpening)openComponentConfiguration();
    if(nativeEditError&&(nativeEditError.selection!==selectionKey||nativeEditError.model!==operations.model))nativeEditError=null;
    if(payload.mdf_recovery_notice)message(payload.mdf_recovery_notice);
    if(nativeEditError)message(nativeEditError.text,'error');
    if(editRejection){
      if(!flow.current||editRejection.session!==flow.current.contract.session_id||editRejection.revision!==operations.revision)editRejection=null;
      else message(editRejection.text,'error');
    }
    if(lostUserChanges){
      var warning='O modelo foi atualizado. O rascunho anterior foi descartado; confira a seleção antes de editar.';
      message(warning,'error');
      // The usual inline error belongs to an active editor. If a stale piece
      // draft closed that editor, keep the real conflict visible in its list.
      if(selectionKind==='module'&&piecesView&&!pieceEditorOpen){
        var notice=document.createElement('div');notice.id='plany-discarded-draft-warning';
        notice.className='plany-operation-feedback error';notice.setAttribute('role','alert');
        notice.textContent=warning;
        var workspace=$('pieces-workspace');workspace.insertBefore(notice,workspace.firstChild);
      }
    }
    return !same&&draft&&(!payload.plany_focus||payload.plany_focus.return_to_origin)?draft:null;
  }
  function focusPlanySelection(focus){
    switchTab('module');
    if(selectionKind!=='module')return;
    if(focus.return_to_origin){activateSelectionStep('front-details',false);$('insertions-history').open=true;updateChrome();return;}
    if(focus.pieces){pieceEditorOpen=false;setPiecesView(true);return;}
    if(focus.piece_role){setPiecesView(true);openModulePieceEditor(focus.piece_role);return;}
    var insertion=focus.insertion||[],kind=insertion[0],key=insertion[1],role=focus.role;
    if(kind==='piece'){setPiecesView(true);openModulePieceEditor(role);return;}
    if(kind==='carcass'){activateSelectionStep('construction-settings',false);updateChrome();return;}
    activateSelectionStep('front-details',false);
    $('insertions-history').open=true;
    if(kind==='split'){
      var matches=M.layout(state.params).panels.filter(function(piece){
        if(piece.role.indexOf('split:')!==0)return false;
        var id=piece.role.slice(6),node=M.find(state.params,id);
        return (node&&node.insertion_batch||id)===key;
      });
      if(matches.length){openDivisionBatch(matches);return;}
    }
    if(kind==='front'){
      var frontButton=Array.prototype.find.call(document.querySelectorAll('[data-front]'),function(button){return button.dataset.front===key;});
      if(frontButton){frontButton.click();return;}
    }
    if(kind==='cladding'){clearInternalEditors();openCladdingEditor('all');return;}
    if(kind==='trim'){clearInternalEditors();openTrimEditor(key,trimForKind(key));return;}
    if(role){setPiecesView(true);openModulePieceEditor(role);}
  }
  function openDivisionBatch(pieces){
    if(state.busy||!pieces.length)return;
    var originScroll=document.querySelector('main').scrollTop;
    clearInternalEditors();
    clearEdgeHover();cancelInsertTool();
    divisionBatch={roles:pieces.map(function(piece){return piece.role;}),key:selectionKey,fields:{},originScroll:originScroll};
    editorContext={owner:'insertion',target_id:operations.target,target_revision:operations.revision};
    var editor=$('plany-batch-editor');
    if(!editor){editor=document.createElement('section');editor.id='plany-batch-editor';editor.className='item-editor';$('insertions-history').parentNode.insertBefore(editor,$('insertions-history'));}
    editor.textContent='';editor.hidden=false;
    var shelf=pieces[0].thickness_axis===2,title=document.createElement('h3');
    title.textContent='Editar '+U.count(pieces.length,shelf?'prateleira':'divisória',shelf?'prateleiras':'divisórias');editor.appendChild(title);
    var intro=document.createElement('p');intro.className='hint';intro.textContent=pieces.length===1?'Confira as configurações desta peça.':'Confira as '+pieces.length+' peças. Campos com valores diferentes preservam cada valor até você alterá-los.';editor.appendChild(intro);
    {
      var distribution=document.createElement('div'),keepRow=document.createElement('label'),keep=document.createElement('input'),keepText=document.createElement('span'),keepControl=document.createElement('span');
      distribution.className='division-distribution-fields';editor.appendChild(distribution);
      keep.type='checkbox';keep.id='plany-batch-proportions';keep.checked=pieces.every(function(piece){return M.find(state.params,piece.role.slice(6)).keep_divider_proportions===true;});keep.dataset.initial=String(keep.checked);
      keepRow.className='field';keepRow.title='Reajusta os vãos proporcionalmente quando o módulo muda.';keepText.textContent='Reajuste automático';keep.setAttribute('aria-label','Reajuste automático');keep.addEventListener('change',function(){applyExistingCheckbox(keep);});keepControl.className='division-proportions-control';keepControl.appendChild(keep);keepRow.appendChild(keepText);keepRow.appendChild(keepControl);distribution.appendChild(keepRow);divisionBatch.keep=keep;
    }
    function field(key,label,values,options){
      var mixed=U.fieldState(values),common=mixed.value;
      var control=document.createElement(options?'select':'input'),row=document.createElement('label');
      control.id='plany-batch-'+key;row.className='field';row.textContent=label;
      if(options){
        (mixed.mixed?[['','Valores diferentes']].concat(options):options).forEach(function(item){var option=document.createElement('option');option.value=String(item[0]);option.textContent=item[1];control.appendChild(option);});
        if(common&&!Array.prototype.some.call(control.options,function(option){return option.value===common;})){var option=document.createElement('option');option.value=common;option.textContent=common+' · valor atual';control.appendChild(option);}
      }else{control.inputMode='decimal';control.placeholder=mixed.mixed?'Valores diferentes':'';}
      control.value=common;control.dataset.initial=common;control.dataset.mixed=String(mixed.mixed);row.appendChild(control);editor.appendChild(row);divisionBatch.fields[key]=control;
      return control;
    }
    function values(key,fallback){return pieces.map(function(piece){var value=(piece.settings||{})[key];return value===undefined?fallback:value;});}
    var types=values('construction_type','mdf');
    var type=field('type','Tipo',types,[['mdf','MDF'],['glass','Vidro']]);
    {
      var ordered=pieces.slice().sort(function(a,b){return a.role.length-b.role.length;});
      var count=field('count','Quantidade',[pieces.length],Array.from({length:8},function(_,i){return [i+1,String(i+1)];}));distribution.insertBefore(count.parentNode,keepRow);
      if(M.dividerChain(M.find(state.params,ordered[0].role.slice(6))).length===pieces.length)divisionBatch.root=ordered[0].role.slice(6);
      else{count.disabled=true;var reason=document.createElement('small');reason.className='hint';reason.textContent='Este lote contém peças removidas. A quantidade mostra as peças existentes; as outras configurações continuam disponíveis.';count.parentNode.appendChild(reason);count.title=reason.textContent;}
      if(!shelf)field('divider_mode','Divisória',values('divider_mode','internal'),[['internal','Divisória interna'],['batente','Batente frontal']]);
    }
    field('fixation','Tipo de fixação',values('fixation','screw'),[['screw','Parafusada'],['dowel','Cavilhada'],['connector','Conector']].concat(shelf?[['shelf_support','Suporte de apoio'],['angle','Cantoneira']]:[]));
    var material=field('material',pieces.length===1?'MDF da peça':'MDF das peças',pieces.map(function(piece){return piece.settings.material||piece.material||state.params.material;}));
    material.type='hidden';material.parentNode.appendChild(createMaterialChoice(material,{emptyLabel:material.dataset.mixed==='true'?'Valores diferentes':'Escolher MDF',label:pieces.length===1?'MDF da peça':'MDF das peças'}));
    field('glass_color','Cor do vidro',values('glass_color','clear'),[['clear','Incolor'],['smoke','Fumê'],['bronze','Bronze'],['green','Verde']]);
    field('thickness','Espessura (mm)',pieces.map(function(piece){return piece.size[piece.thickness_axis];}),mdfThicknesses(3,40).concat([[4,'4 mm'],[8,'8 mm'],[10,'10 mm']]).filter(function(item,index,array){return array.findIndex(function(other){return String(other[0])===String(item[0]);})===index;}));
    field('recess','Recuo frontal (mm)',values('front_recess',0));
    if(!shelf){field('span',pieces.length===1?'Altura da divisória (mm)':'Altura das divisórias (mm)',pieces.map(function(piece){return piece.size[2];}));
    field('depth','Profundidade (mm)',pieces.map(function(piece){return piece.size[1];}));}
    if(!shelf)field('batente_depth','Profundidade do batente (mm)',values('batente_depth',70));
    if(shelf){field('led','Canal para LED',values('led',false),[['false','Sem canal'],['true','Com canal']]);field('led_position','Posição do LED',values('led_position','front'),[['front','Frente'],['center','Centro'],['rear','Fundo']]);}
    function sync(){
      var fields=divisionBatch&&divisionBatch.fields;if(!fields)return;
      var mdf=type.value==='mdf'||!type.value&&types.every(function(value){return value==='mdf';});
      var glass=type.value==='glass'||!type.value&&types.some(function(value){return value==='glass';});
      if(type.value==='mdf'&&types.every(function(value){return value==='glass';})&&material.value===material.dataset.initial)material.value=state.params.material;
      material.disabled=!mdf;material.parentNode.hidden=!mdf;
      Array.prototype.forEach.call(fields.thickness.options,function(option){option.disabled=glass&&option.value!==''&&[4,6,8,10].indexOf(Number(option.value))<0;});
      if(type.value==='glass'&&[4,6,8,10].indexOf(Number(fields.thickness.value))<0)fields.thickness.value='6';
      Array.prototype.forEach.call(fields.fixation.options,function(option){option.disabled=glass&&option.value!==''&&(shelf?['connector','shelf_support','angle']:['connector']).indexOf(option.value)<0;});
      if(fields.fixation.value&&fields.fixation.options[fields.fixation.selectedIndex].disabled)fields.fixation.value='connector';
      fields.glass_color.parentNode.hidden=type.value!=='glass'&&!(type.value===''&&types.some(function(value){return value==='glass';}));
      if(fields.batente_depth){var batente=fields.divider_mode.value==='batente';fields.batente_depth.parentNode.hidden=!batente;fields.depth.parentNode.hidden=batente;}
      if(fields.led){fields.led.parentNode.hidden=!mdf;fields.led_position.parentNode.hidden=!mdf||fields.led.value!=='true';}
      refreshMaterialButtons();
    }
    editor.onchange=sync;sync();
    var individual=document.createElement('div'),individualTitle=document.createElement('h4');individualTitle.textContent=pieces.length===1?'Peça da inserção':'Peças da inserção';individual.appendChild(individualTitle);
    pieces.forEach(function(piece,index){var button=document.createElement('button');button.className='small-button';button.textContent=(piece.settings.name||piece.name)+' '+(index+1)+' · Editar peça';button.addEventListener('click',function(){
      if(state.busy)return;var saved=snapshotBatch();
      setPiecesView(true);batchReturn=saved;openModulePieceEditor(piece.role);
    });individual.appendChild(button);});editor.appendChild(individual);
    if(window.planyGroupEditor)window.planyGroupEditor(editor);
    updateChrome();document.querySelector('main').scrollTop=0;
  }
  function currentBatchPieces(){
    validateEditContext();
    if(!divisionBatch||divisionBatch.key!==selectionKey)throw new Error('Selecione novamente esta inserção.');
    var panels=M.layout(state.params).panels;
    return divisionBatch.roles.map(function(role){var piece=panels.find(function(item){return item.role===role;});if(!piece)throw new Error('Uma das peças mudou. Reabra a inserção.');return piece;});
  }
  $('apply-batch').addEventListener('click',function(event){if(state.busy)return;try{
    var pieces=currentBatchPieces(),changes={},p=M.clone(state.params);
    Object.keys(divisionBatch.fields).forEach(function(key){var field=divisionBatch.fields[key];if(!field.disabled&&!field.parentNode.hidden&&field.value.trim()!==''&&field.value!==field.dataset.initial)changes[key]=field.value;});
    var keepChanged=divisionBatch.keep&&String(divisionBatch.keep.checked)!==divisionBatch.keep.dataset.initial;
    if(!Object.keys(changes).length&&!keepChanged){message('Nenhuma alteração no conjunto.');return;}
    if(keepChanged)pieces.forEach(function(piece){var node=M.find(p,piece.role.slice(6));node.keep_divider_proportions=divisionBatch.keep.checked;if(!node.keep_divider_proportions){var r=M.layout(p).nodes[node.id];node.distance=M.splitDistance(node,r[node.split==='horizontal'?'height':'width']-M.thickness(p,piece.role));node.position_mode='start';}});
    pieces.forEach(function(piece){
      var data=M.clone(p.piece_settings[piece.role]||{}),current=piece.settings||{};
      var pref={type:current.construction_type||'mdf',fixation:current.fixation||'screw',material:current.material||piece.material||p.material,thickness:piece.size[piece.thickness_axis],front_recess:current.front_recess||0,divider_mode:current.divider_mode||'internal',batente_depth:current.batente_depth||70,glass_color:current.glass_color||'clear',led:!!current.led,led_position:current.led_position||'front'};
      Object.keys(changes).forEach(function(key){if(key!=='span'&&key!=='depth'&&key!=='count')pref[key==='recess'?'front_recess':key]=key==='led'?changes[key]==='true':changes[key];});
      if(changes.type==='mdf'&&current.construction_type==='glass'&&!changes.material)pref.material=p.material;
      if(pref.type==='glass'&&['connector','shelf_support','angle'].indexOf(pref.fixation)<0)pref.fixation='connector';
      applyDivisionConstruction(data,pref,p,piece.thickness_axis===2?'horizontal':'vertical');
      if(changes.material)data.grain=materialGrain(changes.material,data.grain);
      p.piece_settings[piece.role]=data;
    });
    if(changes.span||changes.depth){
      var panels=M.layout(p).panels;
      pieces.forEach(function(piece){var data=p.piece_settings[piece.role],board=panels.find(function(item){return item.role===piece.role;}),adjustment=M.clone(data.adjustment||{size:[0,0,0],offset:[0,0,0]});
        [['span',piece.thickness_axis===2?0:2,4000],['depth',1,1500]].forEach(function(item){if(changes[item[0]])adjustment.size[item[1]]+=M.number(changes[item[0]],item[0]==='span'?'Medida da peça':'Profundidade',50,item[2])-board.size[item[1]];});data.adjustment=adjustment;
      });
    }
    if(changes.count)p=M.setDividerCount(p,divisionBatch.root,Number(changes.count));
    commitInternal(p,false,editorIntent(event));
  }catch(error){message(error.message,'error');}});
  function removeDivisionBatch(pieces){
    if(state.busy)return;
    if(state.dirty){message('Conclua ou cancele a edição do módulo antes de remover esta inserção.','error');return;}
    try{
      if(divisionBatch)pieces=currentBatchPieces();
      var before=readForm(),p=M.clone(before),roles=pieces.map(function(piece){return piece.role;});
      var present=M.layout(p).panels;roles.forEach(function(role){if(!present.some(function(piece){return piece.role===role;}))throw new Error('Uma das peças mudou. Reabra a inserção.');});
      p.excluded_pieces=Array.from(new Set(p.excluded_pieces.concat(roles)));
      roles.forEach(function(role){delete p.piece_settings[role];});
      pendingRemoval={params:M.clone(before),target:state.target,label:countText(pieces.length,pieces[0].thickness_axis===2?'prateleira':'divisória',pieces[0].thickness_axis===2?'prateleiras':'divisórias')};
      clearInternalEditors();commitInternal(p);
    }catch(error){pendingRemoval=null;message(error.message,'error');}
  }
  $('remove-batch').addEventListener('click',function(){if(divisionBatch)removeDivisionBatch([]);});
  $('cancel-batch').addEventListener('click',function(){if(!state.busy){var scroll=divisionBatch&&divisionBatch.originScroll;clearInternalEditors();updateChrome();restoreNavigationScroll(scroll);}});
  function setSelectOptionsForBatch(select,current){
    var items=mdfThicknesses(3,40);
    if(items.every(function(item){return Number(item[0])!==Number(current);}))items.push([current,measureText(current)+' mm · medida atual']);
    select.textContent='';items.forEach(function(item){var option=document.createElement('option');option.value=String(item[0]);option.textContent=item[1];select.appendChild(option);});select.value=String(current);
  }
  function updateBulk(){var labels={material:'material da seleção',front_material:'material das frentes dos módulos',front_thickness:'espessura das frentes dos módulos',thickness:'espessura das peças',grain:'veio',edge_changes:'bordas com fita'};var fields=Object.keys(bulkChanges),hasTargets=!!(selectionPayload.targets&&selectionPayload.targets.length);$('bulk-changes').textContent=!hasTargets?'Este grupo ainda não contém peças cadastradas no Plany.':fields.length?'Será alterado: '+fields.map(function(k){return labels[k];}).join(', ')+'.':'Nenhuma alteração marcada.';$('apply-bulk').disabled=state.busy||!fields.length||!hasTargets;$('bulk-changes').hidden=hasTargets&&!fields.length;}
  ['material','front_material','front_thickness','thickness'].forEach(function(k){$('bulk-'+k).addEventListener('input',function(){if(this.value.trim())bulkChanges[k]=this.value;else delete bulkChanges[k];updateBulk();});});
  $('apply-bulk').addEventListener('click',function(){clearEdgeHover();request('bulk_update',[selectionPayload.targets,bulkChanges]);});
  function colorLink(id,target,callback){$(id).addEventListener('input',function(){$(target).value=this.value;if(callback)callback();else $(target).dispatchEvent(new Event('input'));});}
  $('assemble-pieces').addEventListener('click',function(){
    clearEdgeHover();if(selectionPayload.module_count>1){$('combine-warning').hidden=false;return;}
    request('combine_selection',[selectionPayload.targets,false]);
  });
  $('cancel-combine').addEventListener('click',function(){$('combine-warning').hidden=true;});
  $('confirm-combine').addEventListener('click',function(){request('combine_selection',[selectionPayload.targets,true]);});
  $('register-pieces').addEventListener('click',function(){request('register_pieces');});
  var soloEdges=[],soloAxes=[0,1],soloOriginal={},hoverTimer=null,hoverGeneration=0;
  function measureText(value){return String(Math.round(Number(value)*1000)/1000).replace('.',',');}
  function clearEdgeHover(){
    hoverGeneration++;
    clearTimeout(hoverTimer);
    if(nativeMode&&typeof window.sketchup.highlight_edge==='function')request('highlight_edge',[[], '', null],true);
  }
  function edgeHover(edge,kind){
    clearTimeout(hoverTimer);
    if(state.busy)return;
    if(kind==='solo'&&selectionKind!=='piece')return;
    if(kind==='piece'&&!(selectionKind==='module'&&pieceEditorOpen))return;
    var generation=++hoverGeneration,key=selectionKey,role=kind==='piece'?state.pieceRole:null;
    var ids=kind==='solo'?selectionPayload.pieces&&selectionPayload.pieces.map(function(p){return p.path;}):kind==='piece'?[state.target]:selectionPayload.targets;
    hoverTimer=setTimeout(function(){
      if(generation!==hoverGeneration||key!==selectionKey||state.busy||kind==='piece'&&(!pieceEditorOpen||state.pieceRole!==role)||kind==='solo'&&selectionKind!=='piece')return;
      if(nativeMode&&ids&&typeof window.sketchup.highlight_edge==='function')request('highlight_edge',[ids,edge,role],true);
    },60);
  }
  function fillSolo(p){
    var uv=[0,1,2].filter(function(i){return i!==p.axis;});
    soloAxes=cutAxes(p.size,p.axis,p.settings);
    $('solo-name').value=p.name;
    fillGlassEditor('solo',p.settings,p.size[p.axis]);
    fillPieceElevation('solo',p.module_owned?null:p.elevation);
    [['solo-u',soloAxes[0]],['solo-v',soloAxes[1]],['solo-thickness',p.axis]].forEach(function(pair){var value=p.size[pair[1]];soloOriginal[pair[0]]={text:measureText(value),value:value};setValue(pair[0],measureText(value));});
    $('solo-material').value=p.settings.material||p.material||'Branco TX';$('solo-material').disabled=(p.settings.construction_type||p.family||'mdf')!=='mdf';soloEdges=p.settings.edges.slice();
    $('solo-grain').value=materialGrain($('solo-material').value,p.settings.grain);
    renderSoloPreview();refreshMaterialButtons();
  }
  function mappedSoloEdge(edge){
    var uv=[0,1,2].filter(function(i){return i!==selectionPayload.pieces[0].axis;});
    return soloAxes[0]===uv[0]?edge:(edge[0]==='u'?'v':'u')+edge.slice(1);
  }
  function applySoloPiece(){try{
    clearEdgeHover();var p=selectionPayload.pieces[0],size=p.size.slice(),data=M.clone(p.settings);
    [['solo-u',soloAxes[0]],['solo-v',soloAxes[1]],['solo-thickness',p.axis]].forEach(function(pair){var input=$(pair[0]).value,old=soloOriginal[pair[0]];size[pair[1]]=input===old.text?old.value:input;});
    data.material=$('solo-material').value;data.grain=materialGrain(data.material,p.settings.grain);
    if(glassEditors.solo)Object.assign(data,readGlassEditor('solo'));
    var changes={name:$('solo-name').value,size:size,settings:data},elevation=changedPieceElevation('solo');
    if(elevation!==null)changes.elevation=elevation;
    data.edges=soloEdges.slice();message('Aplicando alteração à peça…');pieceApplyPending='solo';request('update_piece',[p.path,changes]);
  }catch(e){message(e.message,'error');}}

  var catalog=[],chosenMaterial=null,materialDestination=null,materialEditedFields={},catalogFavorites={},catalogPicking=false,catalogPickUnknown=null,catalogFavoritesView=false,activePaint=null,paintStopPending=false;
  var grainAlignment=0,paintTrigger=null,paintFocusPending=false;
  function restorePaintFocus(){
    if(!paintFocusPending)return;
    paintFocusPending=false;
    if(paintTrigger&&paintTrigger.isConnected&&!paintTrigger.disabled)paintTrigger.focus();
    else $('catalog-search').focus();
    paintTrigger=null;
  }
  function showGrainMode(mode,angle){
    if(!activePaint)return;
    activePaint.grainMode=mode;
    $('grain-angle').setAttribute('aria-pressed',String(mode==='angle'));
    $('grain-paint').hidden=mode==='paint';
    $('grain-tool-status').textContent=mode==='paint'?'Pintura ativa. Clique no modelo para pintar. Esc encerra.':'Ângulo livre ativo: '+angle+'°. Clique na peça. Esc encerra.';
  }
  function grainAction(mode){
    if(!activePaint||operations.pending('material_paint'))return;
    try{
      var angle=mode==='angle'?M.number($('grain-angle-value').value,'Ângulo do veio',-36000,36000):mode==='align'?grainAlignment:90;
      request('set_material_grain_tool',[{mode:mode,angle:angle}]);
    }catch(error){$('grain-tool-status').textContent=error.message;message(error.message,'error');}
  }
  ['angle','align','paint'].forEach(function(mode){$('grain-'+mode).addEventListener('click',function(){grainAction(mode);});});
  function endPaintSession(){
    if(!activePaint)return;
    activePaint=null;$('paint-scope-dialog').hidden=true;
    paintFocusPending=true;
    if(operations.pending('material_paint')){paintStopPending=true;return;}
    request('stop_material_paint',[]);
  }
  $('end-material-paint').addEventListener('click',endPaintSession);
  $('grain-angle-value').addEventListener('keydown',function(event){
    if(event.key==='Enter'){
      event.preventDefault();event.stopPropagation();
      if(!event.repeat)$('grain-angle').click();
    }
  });
  document.addEventListener('keydown',function(event){
    var dialog=$('paint-scope-dialog');
    if(dialog.hidden||!activePaint)return;
    if(event.key==='Escape'){
      event.preventDefault();event.stopImmediatePropagation();endPaintSession();
    }else if(event.key==='Tab'){
      var controls=Array.prototype.filter.call(dialog.querySelectorAll('button,input,select,textarea,[tabindex]'),function(node){return !node.disabled&&node.tabIndex>=0&&node.getClientRects().length;});
      if(!controls.length)return;
      event.preventDefault();event.stopPropagation();
      var index=controls.indexOf(document.activeElement),next=event.shiftKey?(index<=0?controls.length-1:index-1):(index+1)%controls.length;
      controls[next].focus();
    }
  },true);
  document.querySelectorAll('input[name="paint-scope"]').forEach(function(input){input.addEventListener('change',function(){
    if(!activePaint||!input.checked)return;
    activePaint.scope=input.value;
    if(!operations.pending('material_paint'))request('set_material_paint_scope',[input.value]);
  });});
  var catalogRevision=0,catalogUsedRevision=0,catalogFavoritesRevision=0,catalogRenderKey=null,catalogAppendBatch=null,catalogRequestPending=false;
  var catalogSearchTimer=null;
  function findCatalogMaterial(value){
    return catalogEntryForValue(value);
  }
  function materialGrain(value,fallback){
    if(value==='Retalho'||value==='SOBRA')return fallback==='u'||fallback==='v'?fallback:'free';
    var entry=findCatalogMaterial(value),grain=entry&&entry.grain;
    if(entry)return grain==='u'||grain==='v'?grain:'free';
    return fallback==='u'||fallback==='v'?fallback:'free';
  }
  try{catalogFavorites=JSON.parse(window.localStorage.getItem('plany.catalog.favorites')||'{}')||{};}catch(_){catalogFavorites={};}
  function catalogFavoriteKey(entry){return String(entry.id||entry.name+'|'+entry.brand);}
  function saveCatalogFavorites(){try{window.localStorage.setItem('plany.catalog.favorites',JSON.stringify(catalogFavorites));}catch(_){}}
  function panelSnapshot(){rememberDraft();var active=document.querySelector('.tab.active');return {params:readForm(),elevation:$('elevation').value,chosen_material:chosenMaterial,target_id:state.target,dirty:state.dirty,selected:state.selected,tab:active?active.dataset.tab:'module',drafts:drafts};}
  var glassEditors={solo:null,piece:null};
  function readGlassEditor(prefix){
    return PlanyGlass.normalize(Object.assign({},glassEditors[prefix],{
      glass_model:$(prefix+'-glass-model').value,glass_color:$(prefix+'-glass-color').value,
      glass_direction:$(prefix+'-glass-direction').value
    }));
  }
  function fillGlassEditor(prefix,data,thickness){
    var glass=data.construction_type==='glass';glassEditors[prefix]=glass?PlanyGlass.normalize(data):null;
    $(prefix+'-glass').hidden=!glass;
    $(prefix+'-material').closest('label').hidden=glass;
    var svg=$(prefix+'-preview');
    if(glass)svg.setAttribute('hidden','');else svg.removeAttribute('hidden');
    svg.previousElementSibling.hidden=glass;
    $(prefix+'-edge-summary').hidden=glass;
    if(glass){svg.textContent='';$(prefix+'-edge-summary').textContent='';}
    var options=glass?PlanyGlass.thicknesses.map(function(t){return [t,t+' mm'];}):mdfThicknesses(3,40);
    var individualExtra=prefix==='piece'&&!!selectedExtra();
    var selected=glass||individualExtra?thickness:data.thickness;
    if(!glass&&prefix==='piece'&&!individualExtra)options.unshift(['','Herdar da caixaria']);
    if(selected!=null&&selected!==''&&options.every(function(o){return Number(o[0])!==Number(selected);}))options.push([selected,measureText(selected)+' mm · medida atual']);
    setSelectOptions(prefix+'-thickness',options,selected==null?'':selected);
    if(!glass)return;
    ['model','color','direction'].forEach(function(key){$(prefix+'-glass-'+key).value=glassEditors[prefix]['glass_'+key];});
    syncGlassEditor(prefix);
  }
  function syncGlassEditor(prefix){
    var model=$(prefix+'-glass-model').value,color=$(prefix+'-glass-color');
    color.disabled=model==='espelho';
    Array.prototype.forEach.call(color.options,function(o){o.disabled=model!=='pintado'&&['white','black'].indexOf(o.value)>=0;});
    if(model==='espelho')color.value='clear';
    else if(model==='pintado'&&color.value==='clear')color.value='white';
    else if(model!=='pintado'&&['white','black'].indexOf(color.value)>=0)color.value='clear';
    $(prefix+'-glass-direction').closest('label').hidden=model!=='canelado';
  }
  ['solo','piece'].forEach(function(prefix){
    var box=document.createElement('div');box.id=prefix+'-glass';box.hidden=true;
    [['model','Modelo de vidro',PlanyGlass.models],['color','Cor do vidro',PlanyGlass.colors],['direction','Sentido do canelado',{vertical:'Vertical',horizontal:'Horizontal'}]].forEach(function(spec){
      var label=document.createElement('label'),select=document.createElement('select');label.className='field';label.textContent=spec[1];select.id=prefix+'-glass-'+spec[0];
      Object.keys(spec[2]).forEach(function(key){var option=document.createElement('option');option.value=key;option.textContent=spec[2][key];select.appendChild(option);});
      label.appendChild(select);box.appendChild(label);select.addEventListener('change',function(){if(glassEditors[prefix])syncGlassEditor(prefix);});
    });
    var material=$(prefix+'-material').closest('label');material.parentNode.insertBefore(box,material);
  });
  function drawEdgePicker(prefix,values,finish){
    var svg=$(prefix+'-preview');if(!svg)return;svg.textContent='';
    svg.appendChild(el('rect',{x:55,y:25,width:170,height:105,fill:finish||'transparent',stroke:'#b09a76'}));
    [['u_min',43,25,12,105,'Esquerda'],['u_max',225,25,12,105,'Direita'],['v_min',55,130,170,12,'Inferior'],['v_max',55,13,170,12,'Superior']].forEach(function(e){
      var value=values[e[0]],rect=el('rect',{x:e[1],y:e[2],width:e[3],height:e[4],fill:value===null?'#c5c7be':value?'#00a878':'#b88d53',stroke:value?'#17674e':'#906b3c','stroke-dasharray':value===null?'4 2':'none',tabindex:0,role:'button','aria-pressed':value===null?'mixed':String(value),'aria-label':'Fita na borda '+e[5].toLowerCase(),'data-tape-edge':e[0],'class':'tape-edge'});
      function toggle(){
        if(state.busy||glassEditors[prefix])return;
        var mapped,edges,render;
        if(prefix==='solo'){
          if(selectionKind!=='piece')return;
          mapped=mappedSoloEdge(e[0]);edges=soloEdges;render=renderSoloPreview;
        }else if(prefix==='piece'){
          if(!(selectionKind==='module'&&pieceEditorOpen))return;
          mapped=mappedPieceEdge(e[0]);edges=pieceEdges;render=renderEdges;
        }else return;
        // Banding is an immediate and independently undoable piece operation.
        // Save only the clicked edge; other unconfirmed form fields are untouched.
        if(edgePending){message('Aguarde a confirmação da fita anterior.');return;}
        var previous=edges.slice(),at=edges.indexOf(mapped),enabled=at<0;
        if(enabled)edges.push(mapped);else edges.splice(at,1);
        render();edgeHover(mapped,prefix);
        edgePending={prefix:prefix,previous:previous,current:edges.slice(),selectionKey:selectionKey};
        if(state.dirty)rememberDraft();
        var target=prefix==='solo'?selectionPayload.pieces[0].path:state.target;
        var role=prefix==='solo'?'':state.pieceRole;
        if(!request('set_piece_edge',[target,role,mapped,enabled])){
          if(prefix==='solo'){soloEdges=previous;renderSoloPreview();}
          else{pieceEdges=previous;renderEdges();}
          edgePending=null;
        }
      }
      rect.addEventListener('click',toggle);
      rect.addEventListener('keydown',function(event){if(event.key==='Enter'||event.key===' '){event.preventDefault();toggle();}});
      rect.addEventListener('mouseenter',function(){var mapped=prefix==='solo'?mappedSoloEdge(e[0]):prefix==='piece'?mappedPieceEdge(e[0]):e[0];edgeHover(mapped,prefix);});
      rect.addEventListener('mouseleave',clearEdgeHover);
      rect.addEventListener('focus',function(){var mapped=prefix==='solo'?mappedSoloEdge(e[0]):prefix==='piece'?mappedPieceEdge(e[0]):e[0];edgeHover(mapped,prefix);});
      rect.addEventListener('blur',clearEdgeHover);svg.appendChild(rect);
    });
  }
  function renderSoloPreview(){
    if(!selectionPayload.pieces||!selectionPayload.pieces[0])return;
    if(glassEditors.solo)return;
    var values={};['u_min','u_max','v_min','v_max'].forEach(function(edge){values[edge]=soloEdges.indexOf(mappedSoloEdge(edge))>=0;});
    var value=$('solo-material').value,entry=catalogEntryForValue(value);
    drawEdgePicker('solo',values,entry&&entry.color||(/^#[0-9a-f]{6}$/i.test(value)?value:selectionPayload.pieces[0].color));
    $('solo-edge-summary').textContent=U.count(soloEdges.length,'borda com fita','bordas com fita');
  }
  $('solo-material').addEventListener('input',function(){$('solo-grain').value=materialGrain(this.value,$('solo-grain').value);renderSoloPreview();});
  document.addEventListener('mouseleave',clearEdgeHover);window.addEventListener('blur',clearEdgeHover);
  $('refresh-project-finishes').addEventListener('click',function(){request('refresh_finishes',['all']);});
  function paintSwatch(node,entry){PlanyMaterialChoice.paintSwatch(node,entry);}
  function catalogEntryForValue(value){return PlanyMaterialChoice.catalogEntryForValue(catalog,value);}
  function createMaterialChoice(field,options){return PlanyMaterialChoice.createMaterialChoice(field,options);}
  function refreshMaterialButtons(){
    document.querySelectorAll('[data-material-field]').forEach(function(button){
      var field=$(button.dataset.materialField);if(!field)return;
      var value=field.value,entry=catalogEntryForValue(value),id=field.id;
      var fallback=/^#[0-9a-f]{6}$/i.test(value)?{color:value}:id==='solo-material'&&selectionPayload.pieces&&selectionPayload.pieces[0]?{color:selectionPayload.pieces[0].color}:null;
      PlanyMaterialChoice.refresh(button,field,entry,{disabled:state.busy,emptyLabel:id==='bulk-material'||id==='bulk-front_material'?(field.dataset.mixed==='true'?'Valores diferentes':'Não informado'):id==='solo-material'||id==='piece-material'?'MDF da peça':'Herdar da caixaria',fallback:fallback});
    });
  }
  function renderPieceLibrary(id,entries){
    var list=$(id);list.textContent='';
    if(!entries.length){var empty=document.createElement('p');empty.className='empty';empty.textContent='Selecione uma peça Plany e use Guardar a peça selecionada.';list.appendChild(empty);}
    entries.forEach(function(entry){var button=document.createElement('button'),symbol=document.createElement('div'),body=document.createElement('div'),title=document.createElement('strong'),sizes=document.createElement('p');button.className='library-card';symbol.className='piece-library-symbol';symbol.textContent='▱';title.textContent=entry.name;sizes.textContent=entry.size.map(format).join(' × ')+' mm';body.appendChild(title);body.appendChild(sizes);var action=document.createElement('span');action.className='insert';action.textContent=entry.kind?'Configurar e inserir ↗':'Inserir peça ↗';body.appendChild(action);button.appendChild(symbol);button.appendChild(body);button.addEventListener('click',function(){if(entry.kind)openIndependentComponent(entry);else{rememberDraft();request('insert_piece_library',[entry.id]);}});list.appendChild(button);});
  }
  document.querySelectorAll('[data-library-kind]').forEach(function(button){button.addEventListener('click',function(){var kind=this.dataset.libraryKind;['modules','pieces','handles','hardware'].forEach(function(section){$('library-'+section).hidden=section!==kind;});document.querySelectorAll('[data-library-kind]').forEach(function(b){b.classList.toggle('active',b===button);});});});
  $('save-piece-library').addEventListener('click',function(){var p=selectionPayload.pieces&&selectionPayload.pieces[0];if(p)request('save_piece_library',[p.path]);});
  $('library-config-back').addEventListener('click',function(){modelConfig=null;$('library-config').hidden=true;$('library-content').hidden=false;});
  $('save-model-behavior').addEventListener('click',function(){if(!modelConfig)return;rememberModelRule();request('save_model_behavior',[modelConfig.id,modelConfig.parts]);});
  document.addEventListener('click',function(event){
    var button=event.target.closest('[data-material-field]');if(!button||button.disabled||state.busy)return;
    var active=document.querySelector('.tab.active'),settings=!$('tab-settings').hidden;
    var draft=null;
    if(pieceEditorOpen){draft={inputs:{},edges:pieceEdges.slice()};document.querySelectorAll('#module-piece-editor input,#module-piece-editor select').forEach(function(control){draft.inputs[control.id]={value:control.value,checked:control.checked};});}
    materialDestination={field:button.dataset.materialField,key:selectionKey,returnTab:settings?'settings':active?active.dataset.tab:'module',returnSettingsPage:settingsPage,returnSettingsTab:settingsReturnTab,returnScroll:document.querySelector('main').scrollTop,returnPieces:piecesView,returnPieceEditor:pieceEditorOpen,returnPieceDraft:draft,pieceRole:state.pieceRole};switchTab('materials');
  });
  function restoreMaterialContext(previous){
    switchTab(previous&&previous.returnTab||'module');
    if(previous&&previous.returnTab==='settings'){settingsReturnTab=previous.returnSettingsTab||'module';showSettingsPage(previous.returnSettingsPage||'materials');}
    if(previous&&previous.returnPieces){pieceEditorOpen=!!previous.returnPieceEditor;if(previous.pieceRole)state.pieceRole=previous.pieceRole;setPiecesView(true);if(pieceEditorOpen)fillPiece();}
    if(previous&&previous.returnPieces&&previous.returnPieceDraft&&pieceEditorOpen){
      Object.keys(previous.returnPieceDraft.inputs).forEach(function(id){var control=$(id),saved=previous.returnPieceDraft.inputs[id];if(control){control.value=saved.value;if(control.type==='checkbox')control.checked=saved.checked;}});
      pieceEdges=previous.returnPieceDraft.edges.slice();renderEdges();refreshMaterialButtons();
    }
    if(previous)document.querySelector('main').scrollTop=previous.returnScroll||0;
  }
  $('catalog-picker-back').addEventListener('click',function(){
    if(state.busy)return;
    var previous=materialDestination;materialDestination=null;materialGroup=null;clearCatalogPickStatus();restoreMaterialContext(previous);
  });
  function catalogSubtitle(entry){
    var family=entry.family||'mdf';
    if(family==='mdf'){
      var bits=['MDF'];
      if(entry.brand)bits.push(entry.brand);
      if(entry.line)bits.push(entry.line);
      if(entry.finish&&entry.finish!==entry.line)bits.push(entry.finish);
      return bits.join(' · ');
    }
    if(family==='surplus')return '';
    if(family==='glass')return 'Vidro';
    if(family==='metal')return 'Metal';
    return entry.brand||'Material';
  }
  function renderCatalog(){
    window.clearTimeout(catalogSearchTimer);
    var scope=$('catalog-brand').value,q=$('catalog-search').value.trim().toLocaleLowerCase('pt-BR'),grid=$('catalog-grid');
    var picker=!!materialDestination||!!materialGroup;
    var key=JSON.stringify([catalogRevision,scope,q,catalogFavoritesView,catalogFavoritesRevision,scope==='used'?catalogUsedRevision:0,picker,chosenMaterial&&(chosenMaterial.id||chosenMaterial.name),catalogPickUnknown]);
    if(key===catalogRenderKey){refreshCatalogActions();return;}
    catalogRenderKey=key;grid.textContent='';catalogAppendBatch=null;
    var toolbar=document.querySelector('#tab-materials .catalog-toolbar'),manager=document.querySelector('#tab-materials .catalog-manager');
    if(toolbar)toolbar.hidden=catalogFavoritesView;
    if(manager)manager.hidden=!!materialDestination||!!materialGroup||catalogFavoritesView||scope==='family:surplus'||scope==='family:glass'||scope==='family:metal';
    if($('catalog-favorites-header'))$('catalog-favorites-header').hidden=!catalogFavoritesView;
    if($('catalog-picker-back'))$('catalog-picker-back').hidden=(!materialDestination&&!materialGroup)||catalogFavoritesView;
    var entries=catalog.filter(function(e){
      if(catalogFavoritesView)return !!catalogFavorites[catalogFavoriteKey(e)];
      var hay=(e.name+' '+(e.brand||'')+' '+(e.line||'')+' '+(e.finish||'')+' '+(e.category||'')+' '+(e.family||'mdf')).toLocaleLowerCase('pt-BR');
      if(q)return hay.indexOf(q)>=0;
      if(scope==='all')return true;
      if(scope==='used')return e.used_rank!==undefined;
      if(scope==='family:surplus')return e.family==='surplus';
      if(scope==='family:glass')return e.family==='glass';
      if(scope==='family:metal')return e.family==='metal';
      return e.brand===scope;
    });
    if(!catalogFavoritesView&&scope==='used')entries.sort(function(a,b){return (a.used_rank===undefined?9999:a.used_rank)-(b.used_rank===undefined?9999:b.used_rank);});
    $('catalog-empty').hidden=entries.length>0;
    $('catalog-empty').textContent=catalogFavoritesView?'Você ainda não favoritou nenhum material.':catalogPickUnknown&&q?
      'Material do SketchUp não reconhecido no catálogo: '+catalogPickUnknown+'.':
      q?'Nenhum padrão encontrado.':scope==='used'?'Nenhum material Plany usado neste projeto.':'Nenhum material nesta categoria.';
    $('catalog-picker-hint').hidden=(!materialDestination&&!materialGroup)||catalogFavoritesView;
    var rendered=0,batchSize=!catalogFavoritesView&&scope!=='used'&&entries.length>30?30:entries.length;
    catalogAppendBatch=function(){
      if(rendered>=entries.length)return;
      var end=Math.min(rendered+batchSize,entries.length);
      entries.slice(rendered,end).forEach(function(e){
      var selected=!!chosenMaterial&&((chosenMaterial.id&&e.id&&chosenMaterial.id===e.id)||(!chosenMaterial.id&&!e.id&&chosenMaterial.name===e.name));
      var card=document.createElement('article');card.className='library-card material-card'+(selected?' selected':'');card.setAttribute('aria-pressed',String(selected));
      var swatch=document.createElement('div');swatch.className='catalog-swatch';paintSwatch(swatch,e);card.appendChild(swatch);

      var choose=document.createElement('button');choose.type='button';choose.className='catalog-choose';
      var entryFamily=e.family||'mdf';
      var renderReady=e.render_ready!==false;
      var chooserCompatible=renderReady&&((!materialDestination&&!materialGroup)||entryFamily==='mdf'||entryFamily==='surplus')&&!(materialDestination&&materialDestination.field==='offcut-material'&&entryFamily==='surplus');
      choose.disabled=!chooserCompatible;
      choose.title=PlanyMaterialChoice.fullLabel(e);
      choose.setAttribute('aria-label',choose.title);
      if(!chooserCompatible)choose.setAttribute('aria-description',!renderReady?(e.block_reason||'Arquivo oficial ainda não validado'):'Este campo aceita somente MDF');
      swatch.appendChild(choose);
      choose.addEventListener('click',function(){
        if(state.busy||choose.disabled)return;
        if(materialGroup){
          var group=materialGroup;
          if(group.selectionKey===selectionKey&&group.target===state.target)request('replace_module_material',[group.target,group.key,group.parts,e.id]);
          else message('A seleção mudou. Escolha o material novamente.','error');
        }
        else if(materialDestination)request('use_catalog_material',[e.id]);
        else{chosenMaterial=e;renderCatalog();}
      });

      var favorite=document.createElement('button');favorite.type='button';favorite.className='catalog-favorite';favorite.textContent=catalogFavorites[catalogFavoriteKey(e)]?'★':'☆';
      favorite.title=catalogFavorites[catalogFavoriteKey(e)]?'Remover dos favoritos':'Adicionar aos favoritos';favorite.setAttribute('aria-label',favorite.title);
      favorite.addEventListener('click',function(event){event.stopPropagation();var key=catalogFavoriteKey(e);if(catalogFavorites[key])delete catalogFavorites[key];else catalogFavorites[key]=true;catalogFavoritesRevision++;saveCatalogFavorites();if(catalogFavoritesView)renderCatalog();else{favorite.textContent=catalogFavorites[key]?'★':'☆';favorite.title=catalogFavorites[key]?'Remover dos favoritos':'Adicionar aos favoritos';favorite.setAttribute('aria-label',favorite.title);}});
      swatch.appendChild(favorite);

      var body=document.createElement('div'),title=document.createElement('strong'),label=document.createElement('p');title.textContent=e.name;title.title=e.name;label.textContent=catalogSubtitle(e);body.appendChild(title);body.appendChild(label);card.appendChild(body);

      var family=e.family||'mdf';
      var actions=document.createElement('div');actions.className='catalog-actions catalog-actions-'+family;actions.hidden=!!materialDestination||!!materialGroup;actions.setAttribute('role','group');actions.setAttribute('aria-label','Aplicar '+e.name);swatch.appendChild(actions);
      var actionList=(family==='mdf'||family==='surplus')?[
        ['all','Toda a seleção','M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M8 8h8v8H8z'],
        ['body','Caixaria e internos','M4 4h16v16H4zM7 7h10v13M4 4l3 3M20 4l-3 3'],
        ['fronts','Frentes e fitas','M3 4h8v16H3zM14 4h7v7h-7zM14 14h7v6h-7zM8 11v3M17 7h1M17 17h1'],
        ['claddings','Tamponados e vistas','M4 4h16v16H4zM7 7h10v10H7zM4 4l3 3M20 20l-3-3'],
        ['paint','Pintar MDF e fitas','M9 14l8-10 3 3-10 8M9 14c-5-2-6 3-6 6 4 0 8-1 7-5']
      ]:(family==='glass'||family==='metal')?[
        ['compatible',family==='glass'?'Aplicar às peças de vidro selecionadas':'Aplicar às peças metálicas selecionadas','M5 4h14v16H5zM8 7h8v10H8z']
      ]:[];
      actionList.forEach(function(action){
        var b=document.createElement('button');b.type='button';b.dataset.catalogAction=action[0];b.dataset.catalogFamily=family;b.dataset.renderReady=String(e.render_ready!==false);b.title=e.render_ready===false?(e.block_reason||'Arquivo oficial ainda não validado'):action[1];b.setAttribute('aria-label',b.title);
        var icon=el('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.7,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'});icon.appendChild(el('path',{d:action[2]}));b.appendChild(icon);
        if(action[0]==='claddings')icon.appendChild(el('path',{d:'M4 4h16M4 4v16',stroke:'currentColor','stroke-width':4}));
        b.addEventListener('click',function(event){event.stopPropagation();if(b.disabled)return;materialDestination=null;var ids=selectionPayload.targets||selectionPayload.pieces&&selectionPayload.pieces.map(function(p){return p.path;})||[state.target];
          if(action[0]==='paint'){
            paintTrigger=b;
            activePaint={id:e.id,ids:ids,scope:'individual',grainMode:'paint'};grainAlignment=0;paintStopPending=false;$('paint-scope-material').textContent=e.name;
            showGrainMode('paint');$('grain-align').textContent='Alinhar horizontal';
            $('paint-scope-individual').checked=true;
            $('paint-scope-dialog').hidden=false;
            request('apply_catalog_material',[e.id,ids,'paint_individual']);
          }else request('apply_catalog_material',[e.id,ids,action[0]]);
        });actions.appendChild(b);
      });grid.appendChild(card);
      });
      rendered=end;refreshCatalogActions();
    };
    catalogAppendBatch();
    refreshMaterialButtons();
  }
  document.querySelector('main').addEventListener('scroll',function(){
    if(!$('tab-materials').hidden&&catalogAppendBatch&&this.scrollTop+this.clientHeight>=this.scrollHeight-250)catalogAppendBatch();
  },{passive:true});
  function refreshCatalogActions(){
    document.querySelectorAll('[data-catalog-action]').forEach(function(b){b.disabled=b.dataset.renderReady==='false'||operations.pending(b.dataset.catalogAction==='paint'?'material_paint':'apply_catalog_material')||state.dirty||(b.dataset.catalogAction!=='paint'&&selectionKind==='empty');});
    if($('pick-model-material'))$('pick-model-material').disabled=operations.pending('pick_catalog_material');
    if($('open-catalog-favorites'))$('open-catalog-favorites').disabled=state.busy;
  }
  function renderSources(sources){$('material-sources').textContent='';Object.keys(sources).forEach(function(brand){var b=document.createElement('button');b.className='text-button';b.textContent=brand;b.addEventListener('click',function(){request('open_material_source',[brand]);});$('material-sources').appendChild(b);});}
  function applyCatalogChoice(value){
    var entry=typeof value==='string'?{name:value,value:value}:value;
    var materialValue=entry.value||entry.name;
    if(!materialDestination||materialDestination.field.indexOf('panel-')!==0||materialDestination.field==='panel-main-material')chosenMaterial=entry;
    if(materialDestination&&materialDestination.key===selectionKey){
      var previous=materialDestination,field=previous.field;
      if(!$(field)||$(field).disabled)return;
      $(field).value=materialValue;if($(field).closest('.item-editor'))flow.touch();materialDestination=null;
      materialEditedFields[field]=true;
      if(field==='cladding-material')claddingSharedChanged.material=true;
      if(field==='material'||field==='back_material'||field.indexOf('panel-')===0)changed();
      if(field==='solo-material'){$('solo-grain').value=materialGrain(materialValue,$('solo-grain').value);renderSoloPreview();}
      if(field==='piece-material'){$('piece-grain').value=materialGrain(materialValue,$('piece-grain').value);renderEdges();}
      if(field==='piece-material'&&previous.returnPieceDraft){['piece-material','piece-grain'].forEach(function(id){previous.returnPieceDraft.inputs[id]={value:$(id).value};});}
      if(field==='bulk-material'){bulkChanges.material=materialValue;updateBulk();}
      if(field==='bulk-front_material'||field.indexOf('cut-material-')===0)$(field).dispatchEvent(new Event('input'));
      restoreMaterialContext(previous);
    }
    refreshMaterialButtons();if(!$('tab-materials').hidden)renderCatalog();updateChrome();
  }
  function clearCatalogPickStatus(){
    catalogPickUnknown=null;
    if($('catalog-pick-status')){$('catalog-pick-status').hidden=true;$('catalog-pick-status').textContent='';$('catalog-pick-status').className='catalog-pick-status';}
  }
  $('catalog-brand').addEventListener('change',function(){clearCatalogPickStatus();renderCatalog();});
  $('catalog-search').addEventListener('input',function(){clearCatalogPickStatus();window.clearTimeout(catalogSearchTimer);catalogSearchTimer=window.setTimeout(renderCatalog,120);});
  $('open-catalog-favorites').addEventListener('click',function(){
    catalogFavoritesView=true;clearCatalogPickStatus();renderCatalog();updateChrome();document.querySelector('main').scrollTop=0;
  });
  $('close-catalog-favorites').addEventListener('click',function(){
    catalogFavoritesView=false;renderCatalog();updateChrome();document.querySelector('main').scrollTop=0;
  });
  $('pick-model-material').addEventListener('click',function(){
    if(state.busy)return;
    catalogFavoritesView=false;catalogPickUnknown=null;request('pick_catalog_material');
  });
  function catalogBrand(){return $('catalog-brand').value;}
  $('import-materials').addEventListener('click',function(){
    var brand=$('catalog-brand').value;
    if(['Duratex','Guararapes','Arauco','Berneck'].indexOf(brand)<0){message('Selecione Duratex, Guararapes, Arauco ou Berneck antes de importar o pacote oficial.','error');return;}
    request('import_materials',[brand]);
  });

  window.MyDina = {
    activateOfficialUpdate:function () {
      updateInProgress=false;
      if(state.busy){message('Atualização pronta. Conclua a ação atual e clique em Recarregar Plany.');updateChrome();return;}
      window.MyDina.requestReload();
    },
    requestReload:function () {
      try {
        rememberDraft();
        var active=document.querySelector('.tab.active');
        request('reload_plugin',[panelSnapshot()]);
      } catch (error) { message(error.message,'error'); }
    },
    receive:function (payload) {
      var priorProductionStamp={revision:operations.revision,model:operations.model,generation:operations.modelGeneration,target:operations.target};
      var deleting=operations.owners.piece_edit;
      var outgoing=payload.selection_event?captureSelectionDraft():null,outgoingKey=selectionKey;
      var accepted=operations.accept(payload);if(!accepted)return;
      var collection=state.productionContext,collectionRevision=collection&&collection.revision===undefined?priorProductionStamp.revision:collection&&collection.revision;
      if(state.production&&(accepted.newModel||accepted.canonical&&collectionRevision!==operations.revision||collection&&collection.scope==='selection'&&priorProductionStamp.target!==operations.target))invalidateProduction();
      if(accepted.newModel)drafts={};
      else if(accepted.changed&&outgoing){
        var changedTarget=payload.selection_event&&selectionIdentity(payload)!==outgoingKey;
        if(changedTarget){delete drafts[outgoingKey];}
        else {
        // An idle editor/navigation view is not an unsaved draft. A SketchUp
        // selection or revision notification must not manufacture conflicts.
        if(draftHasUncommittedChanges(outgoing))drafts[outgoingKey]=outgoing;
        else delete drafts[outgoingKey];
        }
      }
      var operation=accepted.meta,ownInternal=internalPending===operation.operation_id;
      if(deleting&&deleting.meta.action==='delete_piece'&&operation.operation_id===deleting.meta.operation_id&&payload.error)deleting.removalError=payload.error;
      var removed=payload.piece_removed,removalConfirmed=!!(removed&&deleting&&deleting.meta.action==='delete_piece'&&payload.selection_event&&!payload.error&&accepted.ownCanonical&&
        operation.caused_by===deleting.meta.operation_id&&removed.target_id===deleting.meta.target_id&&removed.role===deleting.removedRole&&removed.path&&
        (payload.params&&String(removed.role).indexOf('extra:')!==0?M.layout(payload.params).panels.every(function(piece){return piece.role!==removed.role;}):true));
      if(removalConfirmed){deleting.removalProven=true;delete drafts[outgoingKey];delete drafts[selectionIdentity(payload)];invalidateEditContext();}
      if(editorPolicy)editorPolicy.observe(operation,accepted.changed);
      if(libraryRenamePending&&libraryRenamePending.operation===operation.operation_id){
        var renamePending=libraryRenamePending;
        if(payload.error){renamePending.operation=null;renamePending.editor.result(payload.error);}
        else if(payload.library){
          var renamed=(payload.library.saved||[]).find(function(item){return item.id===renamePending.id&&item.name===renamePending.value;});
          if(renamed){state.library=payload.library;renamePending.editor.result(null);}
          else{renamePending.operation=null;renamePending.editor.result('Não foi possível confirmar o novo nome. Confira o item e tente novamente.');delete payload.message;}
        }else if(payload.operation_complete){renamePending.operation=null;renamePending.editor.result('O salvamento não foi confirmado. Confira o item e tente novamente.');}
      }
      if(payload.operation_recovery){
        var receipt=payload.operation_recovery,entry=operations.owners[receipt.owner];
        if(entry&&entry.meta.operation_id===receipt.operation_id){
          if(receipt.status==='running'){message('O SketchUp ainda está executando a alteração. Aguarde a conclusão.');return;}
          rememberDraft();operations.cancel(receipt.owner);invalidateEditContext();recoveryButton.hidden=true;
          message('Operação conferida. Confira o estado atualizado do modelo antes de reaplicar.');updateChrome();
        }
      }
      var contextInvalidated=false;
      if(accepted.newModel||payload.applied)nativeEditError=null;
      if(operation.event&&operation.owner==='system'&&payload.native_edit_error!==undefined){
        nativeEditError=payload.native_edit_error&&payload.error?{selection:selectionKey,model:operations.model,text:payload.error}:null;
      }
      if(accepted.newModel){
        pieceExportPending=false;
        activePaint=null;paintStopPending=false;$('paint-scope-dialog').hidden=true;
        edgePending=null;pieceApplyPending=null;catalogPicking=false;
      }
      if(accepted.changed){
        var pieceWrite=operations.owners.piece_edit,extraWrite=operations.owners.set_extra_data;
        var ownPieceSave=accepted.ownCanonical&&(operation.owner==='piece_edit'||pieceWrite&&operation.caused_by===pieceWrite.meta.operation_id||pieceEditorOpen&&(operation.action==='set_extra_data'||extraWrite&&operation.caused_by===extraWrite.meta.operation_id));
        var ownOption=checkboxPending&&(checkboxPending.operation===operation.operation_id||checkboxPending.operation===operation.caused_by);
        var ownEdit=ownOption||removalConfirmed||ownInternal||internalPending===operation.caused_by||operation.owner==='volume'&&!operation.event||ownPieceSave;
        if(ownEdit){
          flow.advance(operation);
          if(editorContext){editorContext.target_revision=operations.revision;editorContext.target_id=operations.target;}
          if(ownOption&&flow.current){flow.current.contract.target_revision=operations.revision;flow.current.contract.target_id=operations.target;}
          if(batchReturn&&payload.retargeted_from===operation.target_id)batchReturn.key=selectionIdentity(payload)||batchReturn.key;
          if(batchReturn&&ownPieceSave)Object.assign(batchReturn,returnStamp());
          if(batchReturn)Object.assign(batchReturn,returnStamp());
        }else {
          // A routine SketchUp geometry/model notification invalidates the
          // revision stamp, but is not proof that the selected piece changed.
          // Refresh silently when no unsaved edit exists; do not flood the
          // user with a false stale-target error on every normal transaction.
          var unconfirmedEdit=!!(state.dirty||(flow.current&&flow.current.pending));
          batchReturn=null;
          contextInvalidated=invalidateEditContext();
          if(operation.event&&!unconfirmedEdit)contextInvalidated=false;
        }
      }
      if(payload.operation_complete){
        if(checkboxPending&&checkboxPending.operation===operation.operation_id)checkboxPending=null;
        if(deleting&&deleting.meta.action==='delete_piece'&&operation.operation_id===deleting.meta.operation_id&&!deleting.removalProven)message(deleting.removalError||'A remoção não foi confirmada. Confira o estado atualizado do modelo antes de tentar novamente.','error');
        if(!pendingRecoverable())recoveryButton.hidden=true;
        if(operation.owner==='save_piece_export'){pieceExportPending=false;}
        if(operation.owner==='material_paint'&&paintStopPending){paintStopPending=false;request('stop_material_paint',[]);}
        else if(operation.owner==='material_paint'&&activePaint&&activePaint.scope!==activePaint.confirmedScope)request('set_material_paint_scope',[activePaint.scope]);
        updateChrome();if(editorPolicy)editorPolicy.received(payload,operation);return;
      }
      if(payload.error&&(operation.owner==='export_pieces'||operation.owner==='save_piece_export'))pieceExportPending=false;
      if(payload.piece_export){
        var exported=payload.piece_export;
        window.setTimeout(function(){
          try{
            var result=window.PlanyPieceExport.generate(exported.rows,exported.catalog,exported.format,exported.partial);
            if(!request('save_piece_export',[exported.token,window.PlanyPieceExport.bytesBase64(result.bytes)]))pieceExportPending=false;
          }catch(error){pieceExportPending=false;message(error.message,'error');}
          updateChrome();
        },0);
      }
      if(payload.update_status){
        var update=payload.update_status,phase=update.phase||'checking';
        updateInProgress=phase!=='ready'&&phase!=='error'&&phase!=='current';
        var labels={checking:'Consultando a versão oficial…',downloading:'Baixando atualização…',verifying:'Verificando o pacote…',installing:'Preparando a nova versão…',ready:'Atualização pronta. Ativando…',error:'Falha na atualização.'};
        var label=update.detail||labels[phase]||'Atualizando Plany…';
        if(phase==='downloading'&&update.total>0)label='Baixando Plany '+Math.min(100,Math.floor(100*update.received/update.total))+'% ('+(update.received/1048576).toFixed(1)+' de '+(update.total/1048576).toFixed(1)+' MB)…';
        message(label,phase==='error'?'error':'');
      }
      if(operation.owner==='optimize_cut'||operation.owner==='improve_cut'||operation.owner==='cancel_cut')state.searching=!!payload.searching;
      if(operation.owner==='reload_plugin'&&operation.complete&&reloadTimeout){window.clearTimeout(reloadTimeout);reloadTimeout=null;}
      if(operation.owner==='material_paint'&&payload.material_paint_active!==undefined){
        if(payload.material_paint_closed===true||operation.action==='stop_material_paint'&&!payload.material_paint_active){
          activePaint=null;paintStopPending=false;$('paint-scope-dialog').hidden=true;
          // Catalog replies can rebuild/remove the original trigger. Restore
          // after this receive finishes rendering and enabling its controls.
          window.setTimeout(restorePaintFocus,0);
        }else if(activePaint){
          if(payload.material_paint_scope!==undefined)activePaint.confirmedScope=payload.material_paint_scope;
          if(!payload.material_paint_active||payload.material_paint_tool_active===false){
            $('grain-angle').setAttribute('aria-pressed','false');
            $('grain-tool-status').textContent='Ferramenta pausada. Escolha uma ação para continuar.';
            $('grain-paint').hidden=false;
          }
        }
      }
      if(operation.owner==='material_paint'&&activePaint&&payload.material_grain_mode!==undefined){
        showGrainMode(payload.material_grain_mode,payload.material_grain_angle===undefined?$('grain-angle-value').value:payload.material_grain_angle);
        if(payload.material_grain_alignment!==null&&payload.material_grain_alignment!==undefined){
          grainAlignment=Number(payload.material_grain_alignment)===0?90:0;
          $('grain-align').textContent='Alinhar '+(grainAlignment===0?'horizontal':'vertical');
          $('grain-tool-status').textContent='Alinhamento aplicado: '+(grainAlignment===90?'horizontal':'vertical')+'. Próximo clique alterna a direção.';
        }
      }
      if(payload.error&&operation.owner==='material_paint'&&activePaint)$('grain-tool-status').textContent=payload.error;
      if(operation.owner==='material_paint'&&activePaint&&payload.material_grain_result)$('grain-tool-status').textContent=payload.message;
      if(operation.owner==='material_paint'&&activePaint&&payload.material_grain_error)$('grain-tool-status').textContent=payload.material_grain_error;
      if(ownInternal&&payload.applied){
        if(flow.current&&flow.current.pending&&flow.current.pending.intent==='apply')flow.current.appliedParams=M.clone(payload.params);
        var willClose=flow.current&&flow.current.pending&&flow.current.pending.intent!=='apply';
        if(willClose)finishVolumeSession();
        var resolution=flow.resolve(operation,false);internalPending=false;
        if(resolution&&resolution.intent==='apply')payload.message='Configurações aplicadas. Continue editando ou conclua a edição.';
        else if(resolution){closeCompletedSession();if(resolution.intent==='cancel')payload.message='Inserção cancelada. As alterações provisórias foram removidas.';}
        else clearInternalEditors();
        if(pendingRemoval&&pendingRemoval.operation_id===operation.operation_id){var removed=pendingRemoval;removed.after=M.clone(payload.params);removed.context=operation;pendingRemoval=null;window.setTimeout(function(){if(state.target===removed.target&&operations.owners.removal&&operations.owners.removal.meta.operation_id===removed.operation_id)showUndoToast(removed);},0);}
        if(undoRestorePending===operation.operation_id){undoRestorePending=false;window.setTimeout(function(){message('Exclusão desfeita.','success');},0);}
      }
      if(payload.error){
        if(operation.owner==='list_materials')catalogRequestPending=false;
        if(ownInternal&&flow.current&&operation.result_revision===operations.revision){
          editRejection={session:flow.current.contract.session_id,revision:operations.revision,text:payload.error};
        }
        flow.resolve(operation,true);
        if(ownInternal)internalPending=false;
        if(pendingRemoval&&pendingRemoval.operation_id===operation.operation_id)pendingRemoval=null;
        if(undoRestorePending===operation.operation_id)undoRestorePending=false;
      }
      if(payload.error&&operation.owner==='piece_edit'){
        if(edgePending){
          if(edgePending.prefix==='solo'){soloEdges=edgePending.previous;renderSoloPreview();}
          else{pieceEdges=edgePending.previous;renderEdges();}
          edgePending=null;
        }
        // Preserve the rejected draft; the user can correct it or cancel.
        pieceApplyPending=null;
      }
      if(operation.owner==='piece_edit'&&(payload.applied||payload.selection_event))pieceApplyPending=null;
      if(operation.owner==='piece_edit'&&payload.edge_saved&&edgePending&&edgePending.selectionKey===selectionKey){
        var saved=payload.edge_saved,committed=edgePending.current.slice();
        function commitEdge(data){
          data.edges=committed.slice();data.edge_override=true;
        }
        if(edgePending.prefix==='solo'&&selectionPayload.pieces&&selectionPayload.pieces[0]){
          commitEdge(selectionPayload.pieces[0].settings);
        }else if(edgePending.prefix==='piece'){
          var role=saved.role;
          if(role.indexOf('extra:')===0){
            var extra=state.extras.find(function(item){return 'extra:'+item.id===role;});
            if(extra)commitEdge(extra.settings);
          }else{
            [state.params,baseParams].forEach(function(recipe){
              if(!recipe)return;
              recipe.piece_settings=recipe.piece_settings||{};
              var data=recipe.piece_settings[role]||{};
              commitEdge(data);recipe.piece_settings[role]=data;
            });
          }
        }
        edgePending=null;
      }
      if(operation.owner==='opening_selection'&&payload.opening_tool!==undefined){
        var session=flow.current;
        if(session&&session.opening_operation_id===operation.operation_id){
          setActiveInsertTool(payload.opening_tool||null);
          if(!payload.opening_tool&&!session.pending){
            if(payload.opening_cancelled)cancelInsertSession();
            else{finishVolumeSession();flow.dismiss('native_tool_closed');closeCompletedSession();}
          }
        }
      }
      if(payload.catalog_used){
        var ranks={},usedChanged=false;
        payload.catalog_used.forEach(function(id,index){ranks[id]=index;});
        catalog.forEach(function(entry){var rank=ranks[entry.id];if(entry.used_rank!==rank)usedChanged=true;if(rank===undefined)delete entry.used_rank;else entry.used_rank=rank;});
        if(usedChanged){catalogUsedRevision++;if(!catalogFavoritesView&&$('catalog-brand').value==='used'&&!$('tab-materials').hidden)renderCatalog();}
      }
      if(operation.owner==='opening_selection'&&payload.loose_door_area&&flow.volume){
        var area=payload.loose_door_area;['width','height','depth'].forEach(function(k){flow.creation.baseParams[k]=area[k];});
        flow.openings=[{id:'root',x:0,z:0,width:area.width,height:area.height,depth:area.depth,front:0,rear:area.depth}];updateInsertTargetCount();
      }
      if(operation.owner==='volume'&&payload.component_created&&flow.owns(operation)){finishVolumeSession();flow.resolve(operation,false);internalPending=false;closeCompletedSession();}
      if(payload.selection_event){
        var preserveFields=!accepted.changed&&selectionIdentity(payload)===selectionKey&&(pieceEditorOpen||selectionKind==='piece');
        var savedInputs={};
        if(preserveFields){
          var ids=pieceEditorOpen?['piece-name','piece-thickness','piece-material','piece-tape','piece-decrement','piece-u','piece-v','piece-elevation','position-mode','position-value']:
            ['solo-name','solo-u','solo-v','solo-thickness','solo-elevation','solo-material'];
          var prefix=pieceEditorOpen?'piece':'solo';
          if(glassEditors[prefix])ids=ids.concat(['model','color','direction'].map(function(key){return prefix+'-glass-'+key;}));
          ids.forEach(function(id){var control=$(id);savedInputs[id]=control.type==='checkbox'?control.checked:control.value;});
        }
        var selecting=operations.owners.opening_selection;
        var explicitOpeningChange=selecting&&operation.caused_by===selecting.meta.operation_id;
        // An unchanged canonical notification is not a target-selection action.
        // Preserve configured targets before Apply too, including native error/retry.
        var keepSessionTargets=!!flow.current&&!explicitOpeningChange&&!payload.opening&&!(payload.openings||[]).length;
        clearEdgeHover();var returnDraft=receiveSelection(payload);state.canonicalRevision=operations.revision;
        if(!keepSessionTargets)receiveOpening(payload.opening,payload.openings);
        updateChrome();
        if(preserveFields&&selectionIdentity(payload)===selectionKey){Object.keys(savedInputs).forEach(function(id){var control=$(id);if(control.type==='checkbox')control.checked=savedInputs[id];else setValue(id,savedInputs[id]);});var prefix=pieceEditorOpen?'piece':'solo';if(glassEditors[prefix])syncGlassEditor(prefix);else if(pieceEditorOpen)renderEdges();else renderSoloPreview();}
        var restoredReturn=!removalConfirmed&&returnDraft&&restoreSelectionDraft(returnDraft);
        if(payload.plany_focus&&!restoredReturn)focusPlanySelection(payload.plany_focus);
        if(payload.activate_tab)switchTab(payload.activate_tab);
        if(contextInvalidated&&!restoredReturn&&!nativeEditError)message('O alvo foi atualizado. Abra novamente a configuração para continuar.','error');
        if(removalConfirmed){message((removed.name||'Peça')+' removida. Ctrl+Z desfaz.');restoreNavigationScroll(outgoing&&outgoing.ui&&outgoing.ui.scroll||0);}
        else if(deleting&&deleting.removalError&&operation.caused_by===deleting.meta.operation_id)message(deleting.removalError,'error');
        if(editorPolicy)editorPolicy.received(payload,operation);
        if(nativeEditError)message(nativeEditError.text,'error');
        restoreCheckboxDraft(payload,operation);
        return;
      }
      if(payload.applied&&payload.params){materialEditedFields={};$('combine-warning').hidden=true;if(payload.target_id===state.target){delete drafts[selectionKey];}else{rememberDraft();}selectionKey=selectionIdentity(payload)||selectionKey;state.conflict=false;if(materialGroup&&payload.activate_tab==='module')materialGroup=null;}
      if(payload.selection_kind){selectionKind=payload.selection_kind;selectionPayload=payload;}
      if(payload.defaults){userDefaults=M.normalize(payload.defaults);}
      if(payload.command_catalog)commandCatalog=payload.command_catalog;
      if(payload.settings){userSettings=payload.settings;settingsThicknessDraft=userSettings.thicknesses.slice();renderSettings();applyThicknessOptions();document.body.classList.toggle('theme-dark',userSettings.theme==='dark');}
      if(payload.catalog){catalogRequestPending=false;catalog=payload.catalog;catalogRevision++;if(!$('tab-materials').hidden)renderCatalog();renderCustomMaterials();renderSettingsMaterials();}
      if(payload.material_sources)renderSources(payload.material_sources);
      if(payload.material_pick_active!==undefined){
        catalogPicking=!!payload.material_pick_active;
        $('pick-model-material').classList.toggle('active',catalogPicking);
        $('pick-model-material').setAttribute('aria-pressed',String(catalogPicking));
        $('pick-model-material').title=catalogPicking?'Conta-gotas ativo · clique no SketchUp':'Capturar material do SketchUp';
      }
      if(payload.picked_material){
        var picked=payload.picked_material;
        catalogFavoritesView=false;$('catalog-brand').value='all';
        if(picked.recognized&&picked.entry){
          catalogPickUnknown=null;
          chosenMaterial=(catalog||[]).find(function(e){return e.id===picked.entry.id;})||picked.entry;
          $('catalog-search').value=chosenMaterial.name;
          if($('catalog-pick-status')){$('catalog-pick-status').hidden=false;$('catalog-pick-status').className='catalog-pick-status recognized';$('catalog-pick-status').textContent='Material reconhecido · '+chosenMaterial.name;}
          renderCatalog();
          window.setTimeout(function(){var selected=document.querySelector('#catalog-grid .material-card.selected');if(selected)selected.scrollIntoView({block:'nearest'});},0);
        }else{
          chosenMaterial=null;catalogPickUnknown=picked.name||'Material sem nome';
          $('catalog-search').value=catalogPickUnknown;
          if($('catalog-pick-status')){$('catalog-pick-status').hidden=false;$('catalog-pick-status').className='catalog-pick-status unknown';$('catalog-pick-status').textContent='Material não reconhecido · '+catalogPickUnknown;}
          renderCatalog();
        }
      }
      if(payload.chosen_material){applyCatalogChoice(payload.chosen_material);}
      if(payload.progress!==undefined)$('cut-progress').value=payload.progress;
      if(payload.searching){setCutStep(3);$('cut-summary').textContent='Distribuindo as peças nas chapas…';}
      if (payload.params) {
        receiveModuleContext(payload,false);
        if(payload.carcasses)state.carcasses=payload.carcasses;
        if(payload.composite_root_id!==undefined)state.compositeRoot=payload.composite_root_id;
        if(operation.owner==='piece_edit'&&payload.applied_piece_role)state.pieceRole=payload.applied_piece_role;
        state.pieceElevations=payload.piece_elevations||{};
        if (payload.ready) resetTarget();
        if (payload.restored) {
          selectionKey=selectionIdentity(payload);
          state.target=payload.target_id?String(payload.target_id):null;
          state.extras=payload.extras || [];state.moduleMaterials=payload.module_materials||[]; state.dirty=!!payload.dirty;
          state.selected=payload.selected || 'root';
        } else if (payload.target_id) { selectionKind='module'; state.target=String(payload.target_id); state.extras=payload.extras || [];state.moduleMaterials=payload.module_materials||[]; state.dirty=false; }
        fillForm(payload.params);baseElevation=payload.elevation===undefined?0:payload.elevation;$('elevation').value=baseElevation; baseParams=M.clone(payload.base_params||payload.params);
        if(payload.drafts)drafts=payload.drafts;
        if (payload.restored && payload.tab) switchTab(payload.tab);
      }
      if (payload.library) renderLibrary(payload.library);
      if (payload.library_deleted) showLibraryUndo(payload.library_deleted);
      if (payload.model_behavior) {var selectedPart=modelConfig&&modelConfig.id===payload.model_behavior.id?modelConfig.selected:0;modelConfig=payload.model_behavior;modelConfig.selected=Math.max(0,Math.min(selectedPart,modelConfig.parts.length-1));renderModelBehavior();}
      if(payload.production||payload.error&&operation.action==='read_production')productionFeedback(payload.error||'Peças e materiais carregados.',!!payload.error);
      if(payload.production_stale)invalidateProduction();
      if(Object.prototype.hasOwnProperty.call(payload,'production_partial')){if(!payload.production_partial&&(!payload.production_collection_id||state.productionContext&&payload.production_collection_id===state.productionContext.token)||payload.production_partial&&state.productionContext&&payload.production_partial.collection_id===state.productionContext.token){state.partialApproval=payload.production_partial;state.cutPlan=null;$('cut-sheets').textContent='';setCutStep(1);renderProductionIssues();}}
      if(payload.error&&['accept_partial_production','revoke_partial_production','locate_production_issue'].indexOf(operation.action)>=0)renderProductionIssues();
      if (payload.production){state.productionContext=payload.production_context||null;state.productionStale=false;state.partialApproval=null;renderProduction(payload.production);}
      if (payload.cut_plan) renderCut(payload.cut_plan);
      if (payload.central_setup) renderCentralSetup(payload.central_setup);
      if (payload.message) message(payload.message,'success');
      if (payload.error) {message(payload.error,'error');if(payload.error_detail&&payload.error_detail!==payload.error&&editorPolicy)editorPolicy.detail(payload.error_detail);if(cutStep===3&&!state.cutPlan)setCutStep(state.production?2:1);}
      if(payload.activate_tab)switchTab(payload.activate_tab);
      if(payload.open_settings)switchTab('settings');
      if(payload.command_insert)openCommandInsert(payload.command_insert);
      if(payload.opening_action)beginInsertSession(payload.opening_action);
      if(accepted.canonical)state.canonicalRevision=operations.revision;
      if(payload.params&&selectionKind==='module'&&activeSelectionStep==='construction-settings'&&componentKind()&&!(resolution&&resolution.intent!=='apply'))syncComponentStep(activeSelectionStep);
      updateChrome();
      restoreCheckboxDraft(payload,operation);
      if(editorPolicy)editorPolicy.received(payload,operation);
    }
  };

  var editorPolicy=null,tabRefreshers=[];
  function productionFeedback(text,error){var area=$('production-feedback');if(!area){area=document.createElement('p');area.id='production-feedback';area.setAttribute('role','status');area.setAttribute('aria-live','polite');$('read-production').parentNode.insertBefore(area,$('read-production').nextSibling);}area.className='plany-operation-feedback'+(error?' error':'');area.textContent=U.diagnostic(text);}
  function setupEditorPolicy(){
    function footer(id,button){var n=$(id);if(!n){n=document.createElement('div');n.id=id;n.hidden=true;document.querySelector('footer').appendChild(n);}if(button)n.appendChild($(button));return n;}
    footer('bulk-footer','apply-bulk');footer('behavior-footer','save-model-behavior');
    function specification(kind,root,footerId,finishId,cancelId,active,key,title){return {kind:kind,root:root,footer:footerId,finish:finishId,cancel:cancelId,active:active,key:kind+':'+operations.generation+':'+operations.model+':'+operations.modelGeneration+':'+(key||state.target||selectionKey||'') ,title:title};}
    function close(kind,cancel){
      if(kind==='piece'){
        var draft=drafts[selectionKey];if(draft&&draft.pieceDrafts)delete draft.pieceDrafts[state.pieceRole];
        closeModulePieceEditor();
      }else if(kind==='settings'){switchTab(settingsReturnTab);restoreNavigationScroll(settingsReturnScroll);}
      else if(kind==='behavior'){modelConfig=null;$('library-config').hidden=true;$('library-content').hidden=false;updateChrome();}
      else if(kind==='internal'){if(cancel&&flow.current)cancelInsertSession();else {if(flow.current)flow.dismiss('finished');closeCompletedSession();}}
    }
    editorPolicy=window.PlanyEditorPolicy({snapshot:snapshotControls,refresh:updateChrome,footer:syncFooterStatus,error:function(t){message(t,'error');},persisted:function(f){if(f.kind==='settings'||f.kind==='behavior')return true;if(f.kind==='module')return !!state.target&&!state.dirty;if(f.kind==='piece')return !(drafts[selectionKey]&&drafts[selectionKey].pieceDrafts&&drafts[selectionKey].pieceDrafts[state.pieceRole]);return f.kind==='solo'&&!!selectionKey;},
      specs:function(){
        var moduleTab=!$('tab-module').hidden,internal=!!(divisionEdit||divisionBatch||state.editingFront||editingCladding||editingTrim||editingAccessory||insertSessionActive()||standaloneTrim);
        var spec=[],pairs=[['front-editor','front-footer','add-front','cancel-front-edit'],['division-editor','division-footer','apply-division','cancel-division'],['plany-batch-editor','batch-footer','apply-batch','cancel-batch'],['cladding-editor','cladding-footer','add-cladding','cancel-cladding'],['trim-editor','trim-footer','save-trim','cancel-trim'],['accessory-editor','accessory-footer','save-accessory','cancel-accessory']];
        pairs.forEach(function(p){spec.push(specification('internal',p[0],p[1],p[2],p[3],internal&&$(p[0])&&!$(p[0]).hidden&&(moduleTab||standaloneTrim),(flow.current&&flow.current.contract.session_id||p[0])));});
        spec.push(specification('settings','tab-settings','settings-footer','settings-save','settings-cancel',!$('tab-settings').hidden&&['index','construction'].indexOf(settingsPage)<0,settingsPage,'Configurações'));
        spec.push(specification('behavior','library-config','behavior-footer','save-model-behavior','behavior-cancel',!$('tab-library').hidden&&!$('library-config').hidden,modelConfig&&modelConfig.id,'Comportamento do modelo'));
        spec.push(specification('piece','module-piece-editor','piece-footer','piece-footer-action','piece-cancel',moduleTab&&pieceEditorOpen,state.target+':'+state.pieceRole));
        var solo=specification('solo','solo-piece','piece-footer','piece-footer-action','piece-cancel',moduleTab&&selectionKind==='piece',selectionKey,'Peça selecionada');
        solo.management=function(box){[['Remover peça','delete_piece'],['Tornar peça avulsa','detach_piece']].forEach(function(a){if(a[1]==='detach_piece'&&!(selectionPayload.pieces&&selectionPayload.pieces[0].can_detach))return;var b=document.createElement('button');b.type='button';b.className='text-button';b.textContent=a[0];b.onclick=function(){request(a[1],[selectionPayload.pieces[0].path,'']);};box.appendChild(b);});var back=document.createElement('button');back.type='button';back.className='text-button';back.textContent=selectionPayload.selection_return?'← Voltar à seleção':'Ver peças avulsas do projeto';back.onclick=function(){$('solo-back-to-pieces').click();};box.appendChild(back);};spec.push(solo);
        spec.push(specification('bulk','bulk-selection','bulk-footer','apply-bulk','bulk-cancel',moduleTab&&['bulk','pieces','mixed'].indexOf(selectionKind)>=0,selectionKey,'Seleção de peças'));
        var moduleSpec=specification('module',activeSelectionStep,'module-footer','primary-action','module-cancel',moduleTab&&selectionKind==='module'&&!internal&&!piecesView&&activeSelectionStep!=='front-details',state.target+':'+activeSelectionStep,activeSelectionStep==='general-settings'?'Configuração do módulo':constructionTabLabel());
        if(state.params.module_family==='panel')moduleSpec.management=function(box){var b=document.createElement('button');b.type='button';b.className='text-button';b.textContent='Desassociar painéis';b.disabled=$('detach-panel-units').disabled;b.onclick=function(){$('detach-panel-units').click();};box.appendChild(b);};spec.push(moduleSpec);
        $('bulk-footer').hidden=!spec.some(function(s){return s.kind==='bulk'&&s.active;});$('behavior-footer').hidden=!spec.some(function(s){return s.kind==='behavior'&&s.active;});
        $('library-config-back').hidden=true;$('settings-return').hidden=!$('tab-settings').hidden&&['index','construction'].indexOf(settingsPage)<0;if(!spec.some(function(s){return s.kind==='settings'&&s.active;}))$('settings-footer').hidden=true;
        return spec;
      },close:close,cancel:function(kind,baseline){
        if(kind==='module'){if(baseParams)fillForm(M.clone(baseParams));$('elevation').value=baseElevation;numericDrafts.delete($('elevation'));state.dirty=false;updateChrome();}
        else if(kind==='bulk'){bulkChanges={};restoreControls(baseline);updateBulk();}
        else if(kind==='solo'){fillSolo(selectionPayload.pieces[0]);}
        else if(kind==='settings'){settingsThicknessDraft=userSettings.thicknesses.slice();renderSettings();close(kind,true);}
        else if(kind==='piece'){fillPiece();close(kind,true);}
        else close(kind,true);
      }
    });
    document.querySelectorAll('[data-selection-step],.tab').forEach(function(b){b.addEventListener('click',function(){editorPolicy.activate();updateChrome();});});
    ['remove-split','remove-batch'].forEach(function(id){$(id).hidden=true;});
    document.querySelectorAll('#front-editor .danger,#cladding-editor .danger,#trim-editor .danger,#accessory-editor .danger').forEach(function(b){b.hidden=true;});
    setupConfigurationGroups();
    var mainNav=document.querySelector('.tabs');mainNav.id=mainNav.id||'plany-main-tabs';
    tabRefreshers=[U.tabs(mainNav,'data-tab',function(id){return 'tab-'+id;}),U.tabs($('selection-step-tabs'),'data-selection-step',function(id){return id;})];
    editorPolicy.setup();
  }
  function setupConfigurationGroups(){
    // Group only genuine families. An arbitrary keyword must never create a
    // second collapsible heading or isolate a single elevation/recess field.
    function groupChildren(root,definitions){
      if(!root||root.dataset.planyGrouped==='true')return;
      root.dataset.planyGrouped='true';
      definitions.forEach(function(definition,index){
        var nodes=definition.nodes.filter(function(node){return !!node;});
        if(!nodes.length)return;
        var section=U.group(document,definition.title,index===0);
        section.node.id=(root.id||'configuration')+'-group-'+index;
        root.appendChild(section.node);
        nodes.forEach(function(node){section.body.appendChild(node);});
      });
    }
    var general=$('general-settings');
    if(general){
      var body=general.querySelector('.category-body'),dimensions=body&&body.querySelector('.dimensions');
      var elevation=$('elevation').closest('label');
      // Elevation is a dimension, not a reason for a separate section.
      if(dimensions&&elevation)dimensions.appendChild(elevation);
      if(body)groupChildren(body,[{title:'Essenciais',nodes:[body.querySelector('.module-name-field'),dimensions]}]);
    }
    var cabinet=$('cabinet-construction');
    if(cabinet){
      var material=cabinet.querySelector('label.field'),mdf=cabinet.querySelector('#mdf-settings');
      var construction=cabinet.querySelector('#construction-geometry');
      groupChildren(cabinet,[
        {title:'Materiais e acabamentos',nodes:[material,mdf]},
        {title:'Construção e fixação',nodes:[construction]}
      ]);
    }
    // Division/front editors already have intentional details; trim, painting
    // and settings already have approved families. Simple editors need no
    // artificial collapsible section (including accessories and selection).
    window.planyGroupEditor=function(){};
    document.querySelectorAll('label').forEach(function(label){
      var input=label.querySelector('input[type="checkbox"]');
      if(input){label.classList.add('plany-checkbox-field');if(input.parentNode!==label)input.parentNode.classList.add('plany-checkbox-control');}
    });
    document.addEventListener('input',syncConfigurationVisibility);
    document.addEventListener('change',syncConfigurationVisibility);
  }
  function syncConfigurationVisibility(){
    document.querySelectorAll('.plany-config-group').forEach(function(group){
      var controls=group.querySelectorAll('input:not([type="hidden"]),select,textarea,button[data-material-field]');
      if(controls.length)group.hidden=!Array.prototype.some.call(controls,function(control){
        for(var node=control;node&&node!==group;node=node.parentElement)if(node.hidden)return false;
        return true;
      });
    });
  }

  setupVolumeControls();
  setupPiecesWorkspace();
  setupSelectionSteps();
  if($('piece-footer-action'))$('piece-footer-action').addEventListener('click',function(){
    if(selectionKind==='piece')applySoloPiece();
    else if(selectionKind==='module'&&pieceEditorOpen)applyModulePiece();
  });
  if($('open-pieces'))$('open-pieces').addEventListener('click',function(){setPiecesView(true);});
  document.querySelectorAll('.tab').forEach(function (button) { button.addEventListener('click',function () { switchTab(button.getAttribute('data-tab')); }); });
  // A checkbox on an existing module is its own undoable native transaction.
  // Do not apply other unconfirmed numeric/text fields as a side effect.
  var checkboxPending=null;
  function checkboxPatch(p,control){
    var id=control.id;
    if(control.dataset.panelField)p.panel[control.dataset.panelField]=control.checked;
    else if(id==='back'||id==='joint_banding')p[id]=control.checked;
    else if(id==='division-proportions'&&divisionEdit)M.find(p,divisionEdit.id).keep_divider_proportions=control.checked;
    else if(id==='plany-batch-proportions'&&divisionBatch)divisionBatch.roles.forEach(function(role){M.find(p,role.slice(6)).keep_divider_proportions=control.checked;});
    else if(/^trim-(finish|crown|cover)-/.test(id)&&editingTrim){var item=p.trims.find(function(t){return t.kind===editingTrim;});if(!item)return false;item[id.slice(5).replace(/-/g,'_')]=control.checked;}
    else if(/^loose-drawer-(front|runners)$/.test(id)&&state.editingFront){var front=p.fronts.find(function(f){return f.id===state.editingFront;});if(!front)return false;front[id==='loose-drawer-front'?'include_front':'include_runners']=control.checked;}
    else return false;
    return true;
  }
  function restoreCheckboxDraft(payload,operation){
    var saved=checkboxPending;if(!saved||saved.operation!==operation.operation_id&&saved.operation!==operation.caused_by)return;
    if(payload.error){var control=$(saved.id);if(control)control.checked=!saved.checked;checkboxPending=null;return;}
    if(!payload.params)return;
    if(flow.current){checkboxPatch(flow.current.baseParams,$(saved.id));if(flow.current.appliedParams)checkboxPatch(flow.current.appliedParams,$(saved.id));}
    restoreControls(saved.inputs);state.dirty=saved.dirty;
    if(saved.dirty){checkboxPatch(saved.params,$(saved.id));state.params=M.normalize(saved.params,payload.params);}
    if(divisionBatch)divisionBatch.keep.dataset.initial=String(divisionBatch.keep.checked);
    syncExtraFrontControls();syncTrimSideSetbacks();updateChrome();
  }
  function applyExistingCheckbox(control){
    if(selectionKind!=='module'||!state.target||insertSessionActive())return;
    if(state.busy||state.conflict){
      control.checked=!control.checked;
      message('Aguarde a conclusão desta alteração.','error');return;
    }
    try{
      var p=M.clone(baseParams||state.params);
      if(!checkboxPatch(p,control))return;
      var normalized=M.normalize(p,state.params);
      checkboxPending={id:control.id,checked:control.checked,inputs:snapshotControls(document.querySelector('main')),dirty:state.dirty,params:M.clone(state.params)};
      var op=request('update_module',[normalized,state.target,baseElevation]);
      if(op)checkboxPending.operation=op.operation_id;else checkboxPending=null;
    }catch(error){
      checkboxPending=null;control.checked=!control.checked;message(error.message,'error');
    }
  }
  dimensionKeys.concat(constructionKeys,['name','back','elevation','joint_banding']).forEach(function (key) {
    var control=$(key);
    control.addEventListener(control.type==='checkbox'||control.tagName==='SELECT'?'change':'input',
      control.type==='checkbox'?function(){applyExistingCheckbox(control);}:changed);
  });
  ['panel-thickness','panel-main-material'].forEach(function(id){$(id).addEventListener('input',changed);});
  document.querySelectorAll('[data-panel-field]').forEach(function(control){
    control.addEventListener(control.type==='checkbox'||control.tagName==='SELECT'?'change':'input',
      control.type==='checkbox'?function(){applyExistingCheckbox(control);}:changed);
  });
  ['division-proportions','loose-drawer-front','loose-drawer-runners','trim-finish-left','trim-finish-right','trim-finish-back','trim-crown-left','trim-crown-right','trim-crown-back','trim-cover-cladding'].forEach(function(id){$(id).addEventListener('change',function(){applyExistingCheckbox($(id));});});


  $('add-shelf').addEventListener('click',function () { startInsertTool('shelf'); });
  $('add-divider').addEventListener('click',function () { startInsertTool('divider'); });
  $('config-shelf').addEventListener('click',function(){openDivision(state.selected,true,'horizontal');});
  $('config-divider').addEventListener('click',function(){openDivision(state.selected,true,'vertical');});
  $('remove-split').addEventListener('click',function () {
    if(divisionEdit&&!divisionEdit.isNew)removeInserted('division',divisionEdit.id);
  });
  $('primary-action').addEventListener('click',function () {
    try { var p=readForm(),elevation=M.number($('elevation').value,'Elevação',-100000,100000); if(state.target)request('update_module',[p,state.target,elevation]); }
    catch (error) { message(error.message,'error'); }
  });
  $('rule-preset').addEventListener('change',function () { if (this.value!=='custom') preset(this.value); });
  ['width','height','depth'].forEach(function (key) {
    ['follow-','anchor-'].forEach(function (prefix) { $(prefix+key).addEventListener('change',function () { $('rule-preset').value='custom'; describeRule(); }); });
  });
  $('include-parts').addEventListener('click',function () { request('include_parts',[fixedRule()]); });
  $('save-library').addEventListener('click',function () { request('save_library',[state.target,state.params.name]); });
  setupPins();fillForm(M.clone(M.defaults)); preset('fixed'); setupEditorPolicy();updateChrome();
  window.planyInitialized=true;
  if (nativeMode) request('ready');
  else { $('demo-banner').hidden=false; renderLibrary(demoLibrary()); }
})();
