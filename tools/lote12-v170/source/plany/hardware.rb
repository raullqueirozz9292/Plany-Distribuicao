# encoding: UTF-8
%w[hardware_kinematics.rb hardware_mesh.rb].each do |name|
  path = File.join(__dir__, name)
  is_a?(Module) ? module_eval(File.read(path, encoding: 'UTF-8'), path, 1) : load(path)
end
module RQMyDina
  # Visual hardware and native Dynamic Component motion. These objects are not MDF boards.
  module Hardware
    D = Geometry::DICTIONARY
    DC = 'dynamic_attributes'.freeze

    def self.key_for(role, fronts)
      return nil unless role.start_with?('front:')
      fronts.each do |front|
        prefix = "front:#{front['id']}:"
        next unless role.start_with?(prefix)
        number = role.delete_prefix(prefix).split(':').first
        next unless number.match?(/\A\d+\z/)
        return "#{front['id']}:#{number}" if front['kind'] == 'drawers' || front['kind'] == 'door' && (%w[hinged lift].include?(front['door_type']) || front['sliding_version']==1)
      end
      nil
    end

    def self.color(model, name, rgb)
      material = model.materials[name] || model.materials.add(name)
      material.color = Sketchup::Color.new(*rgb)
      material
    end

    def self.box(entities, name, origin, size, material)
      group = entities.add_group
      group.name = name
      group.set_attribute(D, 'hardware', true)
      group.definition.set_attribute(D, 'owned_resource', true)
      face = group.entities.add_face([0, 0, 0], [size[0].mm, 0, 0], [size[0].mm, size[1].mm, 0], [0, size[1].mm, 0])
      face.reverse! if face.normal.z < 0
      face.pushpull(size[2].mm)
      group.material = material
      Graph.set_local_transform(group, Geom::Transformation.translation(origin.map(&:mm)))
      group
    end

    def self.cup(entities, name, center, depth, material)
      group = entities.add_group
      group.name = name
      group.set_attribute(D, 'hardware', true)
      group.definition.set_attribute(D, 'owned_resource', true)
      edge = group.entities.add_circle([0, 0, 0], [0, 1, 0], 17.5.mm, 24)
      face = group.entities.add_face(edge)
      face.reverse! if face.normal.y < 0
      face.pushpull(depth.mm)
      group.material = material
      Graph.set_local_transform(group, Geom::Transformation.translation(center.map(&:mm)))
      group
    end

    def self.clear_generated(entities)
      entities.to_a.each { |entity| entity.erase! if Geometry.part?(entity) && entity.get_attribute(D, 'hardware') }
    end

    def self.mobile_rail_height(front)
      front['runner_height'] - 2 * front['runner_drop']
    end

    def self.hinge_positions(height)
      inset = [100, height / 4.0].min
      return [height / 2.0] if height < 70
      height > 1600 ? [inset, height / 2.0, height - inset] : [inset, height - inset]
    end

    def self.plate_x(spec)
      inner_x = spec['left'] ? spec['region']['x'] : spec['region']['x'] + spec['region']['width']
      spec['left'] ? inner_x : inner_x - 4
    end

    # Engineering pre-check for a conventional MDF flap, not a purchase
    # certificate. Sugatsune NSDX-35/10 lists 20..70 kgf.cm per device;
    # a symmetric L/R pair covers 40..140 kgf.cm. Gas spring sizing
    # cannot be finalized without exact mounting coordinates/lever arm.
    # References: https://global.sugatsune.com/global/en/arch/products/44061_a
    # https://global.sugatsune.com/global/en/arch/products/44059_a
    # https://sugatsune.uk/news/how-do-you-choose-a-motion-control-stay/
    def self.lift_assessment(front, leaf)
      width, thickness, height = leaf.fetch('size').map(&:to_f)
      # A catalogue MDF density benchmark (760 kg/m3), plus a provisional
      # 150 g handle allowance, not a measured or validated actual weight.
      weight = width * thickness * height / 1_000_000_000.0 * 760.0 + 0.15
      moment = weight * (height / 10.0) / 2.0 # kgf.cm
      direction = front['door_opening']=='bottom' ? 'bottom' : 'top'
      system = front.fetch('lift_system', 'gas')
      candidate = {'kind'=>system,'direction'=>direction,'weight_kg'=>weight.round(3),
        'moment_kgf_cm'=>moment.round(2),'quantity'=>2,'opening_angle'=>90,
        'reference'=>system=='mechanical' ? (direction=='bottom' ? 'Sugatsune NSDX-10 L/R' : 'Sugatsune NSDX-35 L/R') : 'pistão genérico',
        'verified'=>false}
      if system == 'mechanical'
        candidate['verified'] = moment >= 40.0 && moment <= 140.0
        candidate['note'] = candidate['verified'] ?
          'Faixa de momento compatível com o par de referência; confirmar posição de montagem, dimensões e dobradiças na ficha do fabricante.' :
          'Momento fora da faixa publicada de 40–140 kgf.cm para o par de referência; selecionar outro articulador com o fabricante.'
      else
        # Nominal 40 mm effective moment arm per piston is an *assumption*,
        # NOT a vendor mounting chart. Only preliminary N are computed.
        required_n = moment * 0.0980665 / (2 * 0.04)
        candidate['required_force_n'] = required_n.round(1)
        options = [60, 80, 100, 120, 150]
        candidate['force_n'] = options.find { |n| n >= required_n } if required_n >= 45
        candidate['note'] = candidate['force_n'] ?
          'Pré-seleção de força (braço eficaz hipotético de 40 mm). Confirmar curva, curso e pontos de fixação pelo fabricante ANTES de comprar.' :
          'Não é possível selecionar com segurança uma força padrão: confirmar a geometria e os pontos de fixação com o fabricante.'
      end
      candidate
    end

    def self.motion_specs(params, wanted)
      boards = wanted.to_h { |piece| [piece['role'], piece] }
      specs = {}
      opening_layout = nil
      params.fetch('fronts', []).each do |front|
        front['count'].times do |i|
          key = "#{front['id']}:#{i}"
          role = "front:#{key}"
          if front['kind'] == 'drawers'
            next unless front['hardware_layout_version'] == 1
            bottom = boards["#{role}:bottom"]
            next unless bottom
            # Full extension follows the nominal telescopic runner length.
            travel = [50, ((front['drawer_type']=='spice' ? front['box_depth'] : bottom['size'][1]) / 50).floor * 50].max
            specs[key] = { 'kind' => 'drawer', 'pivot' => [0, 0, 0], 'travel' => travel, 'front' => front, 'bottom' => bottom }
          elsif front['sliding_version']==1
            leaf=boards[role]
            next unless leaf && leaf['sliding']
            data=leaf['sliding']
            specs[key]={'kind'=>'sliding','pivot'=>[data['x'],0,0],'front'=>front,'leaf'=>leaf,'sliding'=>data,
              'dc_name'=>"PlanyLeaf_#{front['id'].gsub('_','__').gsub('-','_h')}_#{i}"}
          elsif front['door_type'] == 'lift'
            leaf = boards[role]
            next unless leaf
            direction = front['door_opening']=='bottom' ? 'bottom' : 'top'
            z_axis = leaf['origin'][2] + (direction=='top' ? leaf['size'][2] : 0)
            pivot = [leaf['origin'][0], leaf['origin'][1], z_axis]
            opening_layout ||= Parameters.layout(Marshal.load(Marshal.dump(params)))
            region = Parameters.front_region(front, opening_layout['nodes'], opening_layout['openings']).merge('depth'=>params['depth'])
            specs[key] = {'kind'=>'lift','pivot'=>pivot,'angle'=>direction=='top' ? -90 : 90,'region'=>region,
              'axis'=>'X','front'=>front,'leaf'=>leaf,'assessment'=>lift_assessment(front, leaf)}
          elsif front['door_type'] == 'hinged'
            leaf = boards[role]
            next unless leaf
            left = front['door_opening'] == 'left' || front['door_opening'] == 'double' && i.even?
            # Pivot at the outer face of the hinged edge. With the 90-degree
            # outward swing, the complete overlay leaf remains ahead of Y=0.
            pivot = [leaf['origin'][0] + (left ? 0 : leaf['size'][0]), leaf['origin'][1], 0]
            opening_layout ||= Parameters.layout(Marshal.load(Marshal.dump(params)))
            region = Parameters.front_region(front, opening_layout['nodes'], opening_layout['openings'])
            specs[key] = { 'kind' => 'door', 'pivot' => pivot, 'angle' => left ? -90 : 90,
              'left' => left, 'front' => front, 'leaf' => leaf, 'region' => region }
          end
        end
      end
      specs.values.select { |spec| spec['kind']=='sliding' }.each do |spec|
        data=spec['sliding']
        same=specs.values.select { |other| other['kind']=='sliding' && other['front']['id']==spec['front']['id'] && other['sliding']['track']==data['track'] }.sort_by { |other| other['sliding']['x'] }
        index=same.index(spec)
        spec['left_neighbor']=same[index-1].slice('dc_name','sliding') if index>0
        spec['right_neighbor']=same[index+1].slice('dc_name','sliding') if index+1<same.length
      end
      specs
    end

    # Existing modules keep their geometry; only the saved door motion is limited.
    def self.refresh_door_limits(model)
      pending = []
      Graph.walk(model.entities) do |path|
        part = path.last
        next false if path.any?(&:locked?)
        next true unless part.get_attribute(D, 'motion_key')
        formula = part.get_attribute(DC, 'onclick') || part.definition.get_attribute(DC, 'onclick')
        angle = formula.to_s[/\AANIMATE\("ROTZ",0,(-?\d+(?:\.\d+)?)\)\z/, 1]
        next false unless angle && angle.to_f.abs > 90
        pending << [path, angle.to_f < 0 ? -90 : 90]
        false
      end
      return 0 if pending.empty?
      Geometry.transaction(model, 'Plany: limitar abertura das portas a 90°') do
        paths = Graph.unique_paths(pending.map(&:first))
        paths.zip(pending).each do |path, (_, limit)|
          part = path.last
          formula = %(ANIMATE("ROTZ",0,#{limit}))
          part.set_attribute(DC, 'onclick', formula)
          part.definition.set_attribute(DC, 'onclick', formula)
          current = part.get_attribute(DC, 'rotz', 0).to_f
          next unless current.abs > 90
          clamped = current < 0 ? -90 : 90
          transform = Graph.local_transform(part)
          rotation = Geom::Transformation.rotation(transform.origin, [0,0,1], (clamped-current)*Math::PI/180)
          Graph.set_local_transform(part, rotation * transform)
          part.set_attribute(DC, 'rotz', clamped)
        end
      end
      pending.length
    end

    def self.dynamic_motion(instance, spec)
      instance.definition.set_attribute(D, 'owned_resource', true)
      instance.set_attribute(D, 'motion_key', spec['key'])
      instance.definition.set_attribute(D, 'motion_key', spec['key'])
      if spec['kind'] == 'drawer'
        inches = (spec['travel'] / 25.4).round(5)
        formula = %(ANIMATE("Y",0,-#{inches}))
        instance.definition.set_attribute(DC, 'y', 0.0)
        instance.set_attribute(DC, 'y', 0.0)
      elsif spec['kind']=='sliding'
        instance.name=spec['dc_name']
        data=spec['sliding'];low=data['limit_left']/25.4;high=(data['limit_right']-data['width'])/25.4
        left=spec['left_neighbor'];right=spec['right_neighbor']
        min_formula=left ? "LARGEST(#{low},#{left['dc_name']}!X+#{left['sliding']['width']/25.4})" : low.to_s
        max_formula=right ? "SMALLEST(#{high},#{right['dc_name']}!X-#{data['width']/25.4})" : high.to_s
        # Dynamic Components evaluates per-attribute formulas stored as _<attribute>_formula.
        initial_min=left ? [low,(left['sliding']['x']+left['sliding']['width'])/25.4].max : low
        initial_max=right ? [high,(right['sliding']['x']-data['width'])/25.4].min : high
        [instance,instance.definition].each do |target|
          target.set_attribute(DC,'x',data['x']/25.4)
          target.set_attribute(DC,'_plany_min_formula',min_formula)
          target.set_attribute(DC,'_plany_max_formula',max_formula)
          target.set_attribute(DC,'plany_min',initial_min)
          target.set_attribute(DC,'plany_max',initial_max)
        end
        formula='ANIMATE("X",plany_min,plany_max)'
      else
        axis=spec['axis']=='X' ? 'ROTX' : 'ROTZ'
        attr=axis.downcase
        formula = %(ANIMATE("#{axis}",0,#{spec['angle']}))
        instance.definition.set_attribute(DC, attr, 0.0)
        instance.set_attribute(DC, attr, 0.0)
      end
      instance.definition.set_attribute(DC, 'onclick', formula)
      instance.set_attribute(DC, 'onclick', formula)
      instance.definition.set_attribute(DC, '_onclick_label', 'onClick')
      instance.definition.set_attribute(DC, '_formatversion', 1.0)
      instance.definition.set_attribute(DC, '_lengthunits', 'INCHES')
      instance.definition.set_attribute(DC, '_name', instance.name)
      instance.definition.set_attribute(DC, '_hasbehaviors', 1)
      instance.set_attribute(DC, '_hasbehaviors', 1)
      Graph.set_local_transform(instance, Geom::Transformation.translation(spec['pivot'].map(&:mm)))
    end

    def self.prepare(model, definition, params, wanted, categories = {})
      specs = motion_specs(params, wanted)
      if !specs.empty?
        definition.set_attribute(DC, '_hasbehaviors', 1)
        definition.set_attribute(DC, '_formatversion', 1.0)
      elsif definition.get_attribute(DC, '_hasbehaviors')
        definition.set_attribute(DC, '_hasbehaviors', 0)
      end
      wrappers = {}
      motion_paths = []
      Graph.walk(definition.entities) do |path|
        if path.last.get_attribute(D, 'motion_key')
          motion_paths << path
          false
        else
          true
        end
      end
      motion_paths.each do |path|
        entity = path.last
        key = entity.get_attribute(D, 'motion_key')
        if specs.key?(key)
          category_key = specs[key]['kind'] == 'drawer' ? 'drawer' : 'door'
          target = categories[category_key]
          if target && path.first != target
            entity = Geometry.reparent_part(entity, target.definition.entities, Graph.transform(path))
          end
          wrappers[key] = entity.to_component if entity.is_a?(Sketchup::Group)
          wrappers[key] ||= entity
          wrappers[key].make_unique if wrappers[key].definition.instances.length > 1
        else
          # Removing one generated board must not discard loose boards or the
          # other drawer parts still kept by the recipe inside its old wrapper.
          kept = wanted.map { |piece| piece['role'] }
          Graph.boards(entity.definition.entities, true).each do |relative|
            board = relative.last
            role = board.get_attribute(D, 'role')
            next if role && !kept.include?(role)
            category = path.reverse.find { |part| part.get_attribute(D, 'category') }
            destination = category ? category.definition.entities : definition.entities
            Geometry.reparent_part(board, destination, Graph.transform(path + relative))
          end
          entity.erase!
        end
      end
      specs.each do |key, spec|
        spec['key'] = key
        unless wrappers[key]
          category = categories[spec['kind'] == 'drawer' ? 'drawer' : 'door']
          wrapper = (category ? category.definition.entities : definition.entities).add_group
          wrapper.name = spec['kind'] == 'drawer' ? 'Gaveta móvel' : spec['kind']=='sliding' ? 'Porta de correr móvel' : spec['kind'] == 'lift' ? 'Porta basculante móvel' : 'Porta de giro móvel'
          wrappers[key] = wrapper.to_component
        end
        dynamic_motion(wrappers[key], spec)
      end
      # Existing Plany boards were direct children of the module. Move their
      # occurrences under the dynamic wrapper without changing their definition.
      Graph.boards(definition.entities, true).each do |path|
        board = path.last
        role = board.get_attribute(D, 'role')
        key = role && key_for(role, params.fetch('fronts', []))
        next unless key && wrappers[key] && !path.include?(wrappers[key])
        wrapper = wrappers[key]
        local = Geom::Transformation.translation(specs[key]['pivot'].map(&:mm)).inverse * Graph.transform(path)
        copy = wrapper.definition.entities.add_instance(board.definition, local)
        Geometry.copy_attributes(board, copy)
        copy.name = board.name
        copy.material = board.material
        copy.layer = board.layer
        board.erase!
      end
      clear_generated(definition.entities)
      categories.each_value { |category| clear_generated(category.definition.entities) }
      wrappers.each_value { |wrapper| clear_generated(wrapper.definition.entities) }
      return wrappers if specs.empty?
      fixed = color(model, 'Plany · Base da corrediça', [75, 80, 83])
      moving = color(model, 'Plany · Trilho móvel', [120, 125, 126])
      hinge = color(model, 'Plany · Dobradiça de caneco', [150, 153, 150])
      specs.each do |key, spec|
        wrapper = wrappers.fetch(key)
        fixed_entities = categories[spec['kind']=='drawer' ? 'drawer' : 'door']
        fixed_entities = fixed_entities ? fixed_entities.definition.entities : definition.entities
        HardwareMesh.build(self, model, fixed_entities, wrapper, spec,
          {'fixed'=>fixed, 'moving'=>moving, 'hinge'=>hinge}, wanted)
      end
      wrappers
    end
  end
end
