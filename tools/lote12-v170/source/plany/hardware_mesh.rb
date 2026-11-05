# encoding: UTF-8
module RQMyDina
  # Lightweight visible shells based on the manufacturer drawings cited in
  # docs/FERRAGENS-3D-0.6.169.md. Hidden cup/bore volumes are deliberately not
  # superimposed on intact MDF. This layer never cuts or resizes a board.
  module HardwareMesh
    D = 'rq_mydina'.freeze
    DC = 'dynamic_attributes'.freeze
    K = HardwareKinematics

    def self.mark(component, name)
      component.name = name
      component.set_attribute(D, 'hardware', true)
      component.definition.set_attribute(D, 'owned_resource', true)
      component
    end

    def self.component(entities, name)
      mark(entities.add_group.to_component, name)
    end

    def self.prism(entities, points, depth, material)
      face = entities.add_face(points.map { |point| point.map(&:mm) })
      raise 'Não foi possível construir a ferragem.' unless face
      face.reverse! if face.normal.z < 0
      face.pushpull(depth.mm)
      entities.grep(Sketchup::Face).each { |f| f.material = f.back_material = material }
    end

    def self.block(entities, origin, size, material)
      x,y,z=origin;w,d,h=size
      prism(entities,[[x,y,z],[x+w,y,z],[x+w,y+d,z],[x,y+d,z]],h,material)
    end

    def self.cylinder(entities, radius, length, material, sides=16)
      edges=entities.add_circle([0,0,0],[0,0,1],radius.mm,sides)
      face=entities.add_face(edges);face.reverse! if face.normal.z<0;face.pushpull(length.mm)
      entities.grep(Sketchup::Face).each { |f| f.material=f.back_material=material }
      entities.grep(Sketchup::Edge).each { |e| e.soft=e.smooth=true if e.faces.length==2 && e.line[1].parallel?(Z_AXIS) }
    end

    def self.transform(part, origin, angles=[0,0,0])
      tr=Geom::Transformation.translation(origin.map(&:mm))
      [Z_AXIS,Y_AXIS,X_AXIS].zip(angles.reverse).each do |axis,angle|
        tr*=Geom::Transformation.rotation(ORIGIN,axis,angle*Math::PI/180.0) unless angle==0
      end
      Graph.set_local_transform(part,tr)
    end

    def self.formula(part, key, expression, value=nil)
      value=0.0 if value.nil?
      [part,part.definition].each do |owner|
        owner.set_attribute(DC,"_#{key}_formula",expression)
        owner.set_attribute(DC,key,value) unless value.nil?
      end
    end

    def self.dc(part)
      # Mesh may be reused; formulas belong to this occurrence. In particular,
      # a horizontal pin must never inherit the 90° tilt of a flap's pin.
      part.make_unique
      part.definition.delete_attribute(DC)
      part.delete_attribute(DC)
      part.definition.set_attribute(DC,'_formatversion',1.0)
      part.definition.set_attribute(DC,'_lengthunits','INCHES')
    end

    def self.plate(entities,name,origin,size,material)
      part=component(entities,name);block(part.definition.entities,[0,0,0],size,material)
      transform(part,origin);part
    end

    # Same topology/dimensions share a definition, including sleeves and pins.
    def self.stock(entities,name,shape,length,width,thickness,material,plane=:yz)
      model=entities.model
      token="Plany ferragem 169 #{shape} #{length.round(4)} #{width} #{thickness} #{material.name} #{plane}"
      definition=model.definitions[token]
      unless definition
        definition=model.definitions.add(token)
        e=definition.entities
        case shape
        when :round
          cylinder(e,width/2.0,length,material)
        when :link
          # Rounded stamped arm. Longitudinal direction +Z (YZ linkage).
          r=width/2.0
          outline=(0..8).map { |n| a=Math::PI*n/8;[r*Math.cos(a),-r*Math.sin(a),0] }+
            (0..8).map { |n| a=Math::PI+Math::PI*n/8;[r*Math.cos(a),length-r*Math.sin(a),0] }
          prism(e,outline,thickness,material)
          # XY sketch -> longitudinal Z, thickness along X.
          tr=Geom::Transformation.axes(ORIGIN,Y_AXIS,Z_AXIS,X_AXIS)
          e.transform_entities(tr,e.to_a)
        when :channel
          block(e,[0,-width/2.0,0],[thickness,width,length],material)
          block(e,[thickness,-width/2.0,0],[width/3.0,thickness,length],material)
          block(e,[thickness,width/2.0-thickness,0],[width/3.0,thickness,length],material)
        end
        definition.set_attribute(D,'hardware',true)
        definition.set_attribute(D,'owned_resource',true)
      end
      part=mark(entities.add_instance(definition,Geom::Transformation.new),name)
      if plane==:xy
        # +Z -> +Y, thickness +X -> +Z for a horizontal hinge linkage.
        remap=Geom::Transformation.axes(ORIGIN,Z_AXIS,X_AXIS,Y_AXIS)
        # Definitions in this plane are already separate from YZ instances.
        unless definition.get_attribute(D,'plane_mapped')
          definition.entities.transform_entities(remap,definition.entities.to_a)
          definition.set_attribute(D,'plane_mapped',true)
        end
      end
      part
    end

    def self.omit(wrapper,label)
      messages=wrapper.get_attribute(D,'hardware_omitted',[])
      wrapper.set_attribute(D,'hardware_omitted',(messages+[label]).uniq)
    end

    def self.supported?(wanted,axis,coordinate,low,high)
      wanted.any? do |board|
        origin=board['origin'];size=board['size']
        next false unless (origin[axis]-coordinate).abs<0.05 || (origin[axis]+size[axis]-coordinate).abs<0.05
        ((0..2).to_a-[axis]).all? { |i| low[i]>=origin[i]-0.05 && high[i]<=origin[i]+size[i]+0.05 }
      end
    end

    def self.pin(root,name,plane,point,initial,material,radius=3,length=4)
      part=stock(root.definition.entities,name,:round,length,radius*2,0,material);dc(part)
      if plane==:yz
        formula(part,'x',(-length/2.0/25.4).to_s,-length/2.0/25.4)
        formula(part,'y',point[0]);formula(part,'z',point[1]);formula(part,'roty','90',90)
        transform(part,[-length/2.0,*initial],[0,90,0])
      else
        formula(part,'x',point[0]);formula(part,'y',point[1]);formula(part,'z',(-length/2.0/25.4).to_s,-length/2.0/25.4)
        transform(part,[*initial,-length/2.0])
      end
      part
    end

    # Moving links live in a counter-rotated DC frame; the physical mounting
    # plates stay in the cabinet category. Native ANIMATE drives every frame.
    def self.driver(wrapper,name,plane,constant,a,b,lengths=nil,branch=1)
      root=component(wrapper.definition.entities,name);dc(root)
      axis=plane==:yz ? 'rotx' : 'rotz'
      formula(root,'phase',"PARENT!#{axis}",0.0)
      formula(root,axis,'-phase',0.0)
      p,q=plane==:yz ? [1,2] : [0,1]
      coords=[0.0,0.0,0.0];coords[3-p-q]=constant
      transform(root,coords)
      # The compensating frame is at the leaf pivot (not at A). Its global
      # origin and orientation remain constant when the leaf rotates.
      K.formulas(a,b,lengths:lengths,branch:branch).each do |key,expression|
        formula(root,key,expression)
      end
      initial={'by'=>b[0], 'bz'=>b[1], 'dy'=>b[0]-a[0], 'dz'=>b[1]-a[1], 'span'=>K.distance(a,b)}
      if lengths
        elbow=K.joint(a,b,lengths,branch)
        d=K.distance(a,b);u,v=lengths;along=(u*u-v*v+d*d)/(2*d)
        initial.merge!('ey'=>elbow[0],'ez'=>elbow[1],'along'=>along,'rise'=>Math.sqrt([0,u*u-along*along].max))
      end
      initial.each { |key,value| root.set_attribute(DC,key,value/25.4) }
      root.set_attribute(D,'hardware_driver',JSON.generate('plane'=>plane.to_s,'constant'=>constant,'a'=>a,'b'=>b,'lengths'=>lengths,'branch'=>branch))
      root
    end

    def self.segment(root,name,shape,length,width,thickness,material,start,finish,plane,initial_start,initial_finish)
      part=stock(root.definition.entities,name,shape,length,width,thickness,material,plane);dc(part)
      u,v=plane==:yz ? %w[y z] : %w[x y]
      # start/finish are expressions in the driver's inches coordinate system.
      formula(part,u,start[0]);formula(part,v,start[1])
      dy="(#{finish[0]})-(#{start[0]})";dz="(#{finish[1]})-(#{start[1]})"
      formula(part,plane==:yz ? 'rotx' : 'rotz',K.angle_formula(dy,dz))
      point=plane==:yz ? [0,*initial_start] : [*initial_start,0]
      angle=Math.atan2(initial_start[0]-initial_finish[0],initial_finish[1]-initial_start[1])*180.0/Math::PI
      transform(part,point,plane==:yz ? [angle,0,0] : [0,0,angle])
      part.set_attribute(D,'hardware_segment',JSON.generate('start'=>start,'finish'=>finish,'length'=>length,'shape'=>shape.to_s,'plane'=>plane.to_s))
      part
    end

    def self.linkage(wrapper,name,plane,constant,a,b,lengths,branch,material)
      root=driver(wrapper,name,plane,constant,a,b,lengths,branch)
      start=a.map { |n| (n/25.4).to_s };elbow=%w[PARENT!ey PARENT!ez];finish=%w[PARENT!by PARENT!bz]
      initial=K.joint(a,b,lengths,branch)
      if lengths==K::HINGE
        # Furniture cup hinge: overlapping stamped rectangular channel arms.
        # Preserve the original four-bar positions and DC expressions.
        segment(root,'Braço corpo da dobradiça',:channel,lengths[0],15,2.0,material,start,elbow,plane,a,initial)
        segment(root,'Braço articulado da dobradiça',:channel,lengths[1],6,1.8,material,elbow,finish,plane,initial,b)
        pin(root,'Articulação interna',plane,elbow,initial,material,2.2,3)
      else
        segment(root,'Braço junto à base',:link,lengths[0],14,2,material,start,elbow,plane,a,initial)
        segment(root,'Braço junto à folha',:link,lengths[1],6,1.5,material,elbow,finish,plane,initial,b)
        pin(root,'Eixo da base',plane,start,a,material)
        pin(root,'Eixo do cotovelo',plane,elbow,initial,material)
        pin(root,'Eixo da folha',plane,finish,b,material)
      end
      pin(root,'Carcaça do amortecedor',plane,start,a,material,16,10) if lengths==K::NSDX
      root
    end

    def self.cup_shell(wrapper,center,material,dark,lift)
      # Furniture-standard Ø35 cup representation at the inside face of the
      # door. The 13-mm mortise is not cut into existing project MDF.
      # Replace the conspicuous dark disk with a slim mounting flange and a
      # small rectangular articulation cover, matching the approved reference.
      part=component(wrapper.definition.entities,'Caneco Ø35 · flange de fixação')
      e=part.definition.entities
      block(e,[-19,-28,0],[38,56,1.5],material)
      # Visible screw-ring outlines, without heavyweight boolean cutouts.
      [-22,22].each do |y|
        e.add_circle([0.mm,y.mm,1.51.mm],Z_AXIS,2.6.mm,12)
      end
      e.add_circle([0.mm,0.mm,1.52.mm],Z_AXIS,17.5.mm,24)
      # The cover clears the inner side of a 15-mm carcass on an overlay leaf.
      block(e,[-9,-9,1.5],[18,18,4.5],material)
      transform(part,center,[-90,0,0]);part
    end

    def self.hinges(h,model,fixed,wrapper,spec,materials,wanted)
      leaf=spec['leaf'];x,py,z=leaf['origin'];w,t,height=leaf['size'];pivot=spec['pivot'];r=spec['region']
      dark=h.color(model,'Plany · Interior da ferragem',[55,59,62])
      lift=spec['kind']=='lift';upper=spec['angle']<0
      positions=h.hinge_positions(lift ? w : height)
      positions.each_with_index do |at,index|
        if lift
          sign=upper ? -1 : 1
          hinge_z=upper ? r['z']+r['height'] : r['z']
          a=[37-py,hinge_z-pivot[2]+sign*8]
          b=[t+3.5,sign*21.5]
          constant=x+at-pivot[0];plane=:yz;branch=upper ? 1 : -1
          center=[x+at-pivot[0],t+0.05,sign*21.5]
          support=supported?(wanted,2,hinge_z,[x+at-16,21,hinge_z],[x+at+16,53,hinge_z])
        else
          sign=spec['left'] ? 1 : -1
          side=spec['left'] ? r['x'] : r['x']+r['width']
          a=[side-pivot[0]+sign*8,(spec['front']['fit']=='inset' ? t+37 : 37)-py]
          b=[sign*21.5,t+3.5];constant=z+at;plane=:xy;branch=spec['left'] ? 1 : -1
          center=[sign*21.5,t+0.05,z+at]
          support=supported?(wanted,0,side,[side,a[1]+py-16,z+at-16],[side,a[1]+py+16,z+at+16])
        end
        # Tiny leaves cannot accept a Ø35 caneco. Do not invent a scaled hinge.
        if (lift ? height : w)<43 || positions.length*57 > (lift ? w : height)
          omit(wrapper,'Folha sem espaço para caneco Ø35 e flange de 57 mm');next
        end
        unless support && K.valid_sweep?(a,b,spec['angle'],lengths:K::HINGE,branch:branch)
          omit(wrapper,'Dobradiça: envelope incompatível com esta sobreposição');next
        end
        if lift
          plate(fixed,"Calço basculante #{index+1}",[x+at-16,21,upper ? hinge_z-2 : hinge_z],[32,32,2],materials['hinge'])
          plate(fixed,"Apoio do braço basculante #{index+1}",[x+at-3,34,upper ? hinge_z-8 : hinge_z+2],[6,6,6],materials['hinge'])
        else
          base=plate(fixed,"Calço de giro #{index+1}",[side+(sign<0 ? -2 : 0),a[1]+py-16,z+at-16],[2,32,32],materials['hinge'])
          # Two understated mounting screw rings are visible from the inside.
          fix=base.definition.entities
          [8,24].each do |y|
            fix.add_circle([(sign>0 ? 2.01 : -0.01).mm,y.mm,16.mm],X_AXIS,2.5.mm,12)
          end
          plate(fixed,"Apoio do braço de giro #{index+1}",[side+(sign<0 ? -8 : 2),a[1]+py-3,z+at-3],[6,6,6],materials['hinge'])
        end
        cup_shell(wrapper,center,materials['hinge'],dark,lift)
        linkage(wrapper,"Dobradiça articulada #{index+1}",plane,constant,a,b,K::HINGE,branch,materials['hinge'])
      end
    end

    def self.lift(h,model,fixed,wrapper,spec,materials,wanted)
      leaf=spec['leaf'];x,py,z=leaf['origin'];w,t,height=leaf['size'];pivot=spec['pivot'];r=spec['region']
      sign=spec['angle']<0 ? -1 : 1;gas=spec['front']['lift_system']=='gas'
      # Häfele 373.82, 90°: cabinet 38/243, flap 64, side T+13.
      # NSDX-35/10: 50 mm cabinet offset, 98/90 flap, 87 mm arm.
      a=gas ? [38-py,sign*243] : [50-py,sign*(sign<0 ? 113 : 115)]
      b=gas ? [t+13,sign*64] : [t+11,sign*(sign<0 ? 98 : 90)]
      lengths=gas ? nil : K::NSDX;branch=sign<0 ? 1 : -1
      good=K.valid_sweep?(a,b,spec['angle'],lengths:lengths,gas:gas,branch:branch)
      # A complete reference envelope must fit; never shorten a reference stay.
      good &&= height>=(gas ? 275 : 220) && r['width']>=70 && r['depth']>=110
      unless good
        omit(wrapper,"#{gas ? 'Pistão' : 'Articulador'}: sem envelope livre para a referência dimensional");return
      end
      [r['x'],r['x']+r['width']].each_with_index do |side,index|
        dir=index==0 ? 1 : -1;cx=side+dir*13;local_x=cx-pivot[0]
        az=pivot[2]+a[1];ay=py+a[0]
        unless supported?(wanted,0,side,[side,ay-16,az-16],[side,ay+16,az+16])
          omit(wrapper,"Mecanismo #{index+1}: sem lateral para fixação");next
        end
        plate(fixed,"Base lateral #{index+1}",[side+(dir<0 ? -2 : 0),ay-16,az-16],[2,32,32],materials['hinge'])
        # Stand-off joins the screw plate to the ball/cam pin; not a floating pin.
        plate(fixed,"Suporte lateral #{index+1}",[side+(dir<0 ? -13 : 0),ay-3,az-3],[13,6,6],materials['hinge'])
        plate(wrapper.definition.entities,"Fixação na folha #{index+1}",[local_x-8,t,b[1]-16],[16,1.5,32],materials['hinge'])
        plate(wrapper.definition.entities,"Suporte da folha #{index+1}",[local_x-3,t,b[1]-3],[6,b[0]-t,6],materials['hinge'])
        if gas
          root=driver(wrapper,"Pistão #{sign<0 ? 'convencional' : 'inverso'} #{index+1}",:yz,local_x,a,b)
          # Body is fitted to the leaf; the rod enters it with real overlap.
          body=K::GAS['body']/25.4;rod=K::GAS['rod']/25.4
          finish=%w[PARENT!by PARENT!bz];start=a.map { |v| (v/25.4).to_s }
          body_end=["PARENT!by-PARENT!dy*#{body}/PARENT!span","PARENT!bz-PARENT!dz*#{body}/PARENT!span"]
          rod_end=["#{start[0]}+PARENT!dy*#{rod}/PARENT!span","#{start[1]}+PARENT!dz*#{rod}/PARENT!span"]
          span=K.distance(a,b);unit=[(b[0]-a[0])/span,(b[1]-a[1])/span]
          body_tip=b.zip(unit).map { |v,u| v-u*K::GAS['body'] }
          rod_tip=a.zip(unit).map { |v,u| v+u*K::GAS['rod'] }
          segment(root,'Cilindro do pistão',:round,K::GAS['body'],15,0,materials['moving'],finish,body_end,:yz,b,body_tip)
          segment(root,'Haste cromada',:round,K::GAS['rod'],6,0,materials['hinge'],start,rod_end,:yz,a,rod_tip)
          pin(root,'Rótula na caixaria',:yz,start,a,materials['hinge'])
          pin(root,'Rótula na folha',:yz,finish,b,materials['hinge'])
        else
          linkage(wrapper,"Articulador NSDX · #{index+1}",:yz,local_x,a,b,lengths,branch,materials['hinge'])
        end
      end
    end

    def self.rail(entities,name,origin,width,length,height,thickness,material,mirror=false)
      part=component(entities,name);e=part.definition.entities
      block(e,[0,0,0],[thickness,length,height],material)
      lip=[width-thickness,0.5].max
      block(e,[thickness,0,0],[lip,length,thickness],material)
      block(e,[thickness,0,height-thickness],[lip,length,thickness],material)
      origin=origin.dup
      tr=Geom::Transformation.translation(origin.map(&:mm))
      tr*=Geom::Transformation.scaling(-1,1,1) if mirror
      Graph.set_local_transform(part,tr);part
    end

    def self.drawers(h,fixed,wrapper,spec,materials,wanted)
      b=spec['bottom'];x,y,z=b['origin'];w,depth,bt=b['size'];f=spec['front'];gap=f['slide_clearance']
      length=[spec['travel'],depth].min;travel=spec['travel'];pivot=spec['pivot']
      return if f['runner']=='custom'
      rail_z=f['runner']=='concealed' ? z-27.5 : z-f['runner_drop']
      rail_h=f['runner']=='concealed' ? 12 : f['runner_height']
      unless f['loose_drawer'] || [x-gap,x+w+gap].all? { |wall|supported?(wanted,0,wall,[wall,y,rail_z],[wall,y+length,rail_z+rail_h]) }
        omit(wrapper,'Corrediça: sem lateral contínua para fixação');return
      end
      if f['runner']=='concealed'
        # TANDEM reference 27.5 mm minimum lower envelope. Existing flat-bottom
        # recipes with 10 mm clearance cannot accept it without changing MDF.
        layout_bottom=wanted.select { |p| %w[bottom].include?(p['role']) }.map { |p| p['origin'][2]+p['size'][2] }.max || 0
        if z-layout_bottom<27.5
          omit(wrapper,'Corrediça oculta: folga inferior menor que 27,5 mm; MDF preservado');return
        end
        [[x- gap,x+10,false],[x+w+gap,x+w-10,true]].each_with_index do |(wall,mobile,mirror),i|
          dir=mirror ? -1 : 1
          rail(fixed,"Oculta fixa #{i+1}",[wall,y,z-27.5],gap+24,length,12,1.2,materials['fixed'],mirror)
          middle=rail(wrapper.definition.entities,"Oculta intermediária #{i+1}",[mobile-dir*6,y,z-14],18,length,7,1,materials['moving'],mirror)
          dc(middle);formula(middle,'y',"#{y/25.4}-PARENT!Y/2",y/25.4)
          rail(wrapper.definition.entities,"Oculta móvel sob o fundo #{i+1}",[mobile,y,z-6],12,length,6,1,materials['hinge'],mirror)
        end
        return
      end
      height=f['runner_height'];drop=f['runner_drop']
      return omit(wrapper,'Corrediça: folga lateral sem espaço para três perfis') if gap<7
      [[x-gap,false],[x+w+gap,true]].each_with_index do |(wall,mirror),i|
        sign=mirror ? -1 : 1
        rail(fixed,"Telescópica fixa #{i+1}",[wall,y,z-drop],gap*0.35,length,height,1,materials['fixed'],mirror)
        mid=rail(wrapper.definition.entities,"Telescópica intermediária #{i+1}",[wall+sign*gap*0.38,y,z-drop+3],gap*0.28,length,height-6,0.9,materials['moving'],mirror)
        dc(mid);formula(mid,'y',"#{y/25.4}-PARENT!Y/2",y/25.4)
        rail(wrapper.definition.entities,"Telescópica móvel #{i+1}",[wall+sign*gap,y,z],gap*0.25,length,h.mobile_rail_height(f),1,materials['hinge'],!mirror)
      end
    end

    def self.build(h,model,fixed,wrapper,spec,materials,wanted)
      wrapper.delete_attribute(D,'hardware_omitted')
      wrapper.set_attribute(D,'hardware_visual_revision',169)
      if spec['kind']=='drawer'
        return if spec['front']['include_runners']==false
        if spec['front']['drawer_type']=='spice'
          spice_runners(h,fixed,wrapper,spec,materials,wanted)
        else
          drawers(h,fixed,wrapper,spec,materials,wanted)
        end
      elsif spec['kind']=='sliding'
        sliding(h,model,fixed,wrapper,spec,materials)
      else
        hinges(h,model,fixed,wrapper,spec,materials,wanted)
        lift(h,model,fixed,wrapper,spec,materials,wanted) if spec['kind']=='lift'
      end
    end

    def self.spice_runners(h,fixed,wrapper,spec,materials,wanted)
      f=spec['front'];prefix="front:#{f['id']}:0:"
      sides=wanted.select { |piece| piece['role'].start_with?(prefix) && piece['role'].match?(/:(left|right)\z/) }.sort_by { |piece| [piece['origin'][2],piece['origin'][0]] }
      levels=sides.group_by { |piece| piece['origin'][2] }.values
      chosen=case f['spice_runners']
      when 'diagonal' then [levels.first.first,levels.last.last]
      when 'left' then levels.map(&:first)
      when 'right' then levels.map(&:last)
      else sides
      end
      chosen.each_with_index do |side,i|
        x,_,z=side['origin'];right=side['role'].end_with?(':right');gap=f['slide_clearance'];height=f['runner_height'];center=z+30
        raise ArgumentError,'A corrediça ultrapassa a altura da lateral de 60 mm.' if height>60
        wall=right ? x+side['size'][0]+gap : x-gap;sign=right ? -1 : 1
        y=Parameters.drawer_box_start(f);length=spec['travel']
        unless supported?(wanted,0,wall,[wall,y,center-height/2],[wall,y+length,center+height/2])
          omit(wrapper,'Tempereiro: sem lateral contínua para fixar a corrediça');next
        end
        rail(fixed,"Tempereiro · telescópica fixa #{i+1}",[wall,y,center-height/2],gap*0.35,length,height,1,materials['fixed'],right)
        middle=rail(wrapper.definition.entities,"Tempereiro · telescópica intermediária #{i+1}",[wall+sign*gap*0.38,y,center-height/2+3],gap*0.28,length,height-6,0.9,materials['moving'],right)
        dc(middle);formula(middle,'y',"#{y/25.4}-PARENT!Y/2",y/25.4)
        mobile_height=h.mobile_rail_height(f)
        rail(wrapper.definition.entities,"Tempereiro · telescópica móvel #{i+1}",[wall+sign*gap,y,center-mobile_height/2],gap*0.25,length,mobile_height,1,materials['hinge'],!right)
      end
    end

    def self.sliding(h,model,fixed,wrapper,spec,materials)
      s=spec['sliding'];f=spec['front'];leaf=s['leaf'];x=s['x']-spec['pivot'][0];y=s['y'];z=s['z'];w=s['width'];height=s['height'];depth=s['depth']
      if leaf['type']!='mdf'
        rgb=leaf['finish'].downcase.include?('preto') ? [45,47,48] : leaf['finish'].downcase.include?('branco') ? [225,225,220] : [165,170,174]
        material=h.color(model,'Plany · Perfil '+leaf['finish'],rgb)
        profile=component(wrapper.definition.entities,'Perfis da folha de correr')
        e=profile.definition.entities;pw=leaf['profile_width'];wall=leaf['profile_wall']
        [[x,z],[x+w-pw,z]].each_with_index do |(px,pz),index|
          web=index.zero? ? px : px+pw-wall
          block(e,[web,y,pz],[wall,depth,height],material)
          block(e,[px,y,pz],[pw,wall,height],material)
          block(e,[px,y+depth-wall,pz],[pw,wall,height],material)
        end
        [[z,z],[z+height-pw,z+height-wall]].each do |flange,web|
          block(e,[x+pw,y,web],[w-2*pw,depth,wall],material)
          block(e,[x+pw,y,flange],[w-2*pw,wall,pw],material)
          block(e,[x+pw,y+depth-wall,flange],[w-2*pw,wall,pw],material)
        end
      end
      return unless s['index']==0
      root=component(fixed,'Trilhos superior e inferior de correr');e=root.definition.entities
      left=s['limit_left'];length=s['limit_right']-left;base_y=s['y']-s['track']*s['pitch'];wall=1.5;rh=s['rail_height']
      f['track_count'].times do |track|
        ry=base_y+track*s['pitch'];bottom=s['rail_z'];top=s['z']+height
        block(e,[left,ry,bottom],[length,s['pitch'],wall],materials['fixed'])
        block(e,[left,ry,bottom],[length,wall,rh],materials['fixed'])
        block(e,[left,ry+s['pitch']-wall,bottom],[length,wall,rh],materials['fixed'])
        block(e,[left,ry,top+rh-wall],[length,s['pitch'],wall],materials['fixed'])
        block(e,[left,ry,top],[length,wall,rh],materials['fixed'])
        block(e,[left,ry+s['pitch']-wall,top],[length,wall,rh],materials['fixed'])
      end
    end
  end
end
